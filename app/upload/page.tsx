"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useProfiles } from "@/lib/useProfiles";
import type { WardrobeItem } from "@/lib/types";

type QueueItem = {
  localId: string;
  file: File;
  previewUrl: string;
  status: "ready" | "uploading" | "classifying" | "done" | "error";
  message?: string;
  item?: WardrobeItem;
};

function safeFileName(name: string) {
  const withoutExt = name.replace(/\.[^.]+$/, "");
  return withoutExt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 70) || "wardrobe-photo";
}

function titleFromFile(name: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || "Wardrobe photo";
}

export default function UploadPage() {
  const { activeProfile, activeProfileId, loadingProfiles, profileError } = useProfiles();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [extraContext, setExtraContext] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  const counts = useMemo(() => {
    return queue.reduce(
      (acc, item) => {
        acc[item.status] += 1;
        return acc;
      },
      { ready: 0, uploading: 0, classifying: 0, done: 0, error: 0 } as Record<QueueItem["status"], number>
    );
  }, [queue]);

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith("image/"));
    const additions = files.map((file) => ({
      localId: `${Date.now()}-${crypto.randomUUID()}`,
      file,
      previewUrl: URL.createObjectURL(file),
      status: "ready" as const
    }));
    setQueue((current) => [...current, ...additions]);
    event.target.value = "";

    if (files.length > 15) {
      setError("This build will queue the files, but keep batches to 10–15 photos to avoid mobile/browser upload overload.");
    }
  }

  function updateQueue(localId: string, patch: Partial<QueueItem>) {
    setQueue((current) => current.map((item) => item.localId === localId ? { ...item, ...patch } : item));
  }

  function clearDone() {
    setQueue((current) => current.filter((item) => item.status !== "done"));
  }

  async function uploadAndClassify(item: QueueItem) {
    if (!activeProfileId) throw new Error("Choose a wardrobe profile before uploading.");

    updateQueue(item.localId, { status: "uploading", message: "Uploading photo..." });

    const ext = item.file.name.split(".").pop() || "jpg";
    const path = `demo-user/${activeProfileId}/uploads/${Date.now()}-${safeFileName(item.file.name)}.${ext}`;

    const upload = await supabase.storage.from("wardrobe").upload(path, item.file, {
      cacheControl: "3600",
      upsert: false
    });
    if (upload.error) throw upload.error;

    const imageUrl = supabase.storage.from("wardrobe").getPublicUrl(path).data.publicUrl;

    const insert = await supabase
      .from("wardrobe_items")
      .insert({
        owner_id: "demo-user",
        profile_id: activeProfileId,
        name: titleFromFile(item.file.name),
        category: "other",
        image_url: imageUrl,
        storage_path: path,
        classification_status: "queued",
        laundry_status: "clean",
        tags: [],
        is_archived: false,
        angle_count: 1,
        image_role: "primary"
      })
      .select("*")
      .single();

    if (insert.error) throw insert.error;

    await supabase.from("wardrobe_item_photos").insert({
      wardrobe_item_id: insert.data.id,
      image_url: imageUrl,
      storage_path: path,
      source_item_id: insert.data.id,
      angle_label: "primary",
      is_primary: true
    });

    updateQueue(item.localId, { item: insert.data as WardrobeItem, status: "classifying", message: "AI is identifying category, colour, brand, fabric and styling tags..." });

    const response = await fetch("/api/classify-wardrobe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId: insert.data.id,
        extraContext: extraContext || activeProfile?.style_profile || `Classify this for ${activeProfile?.display_name || "this profile"}'s real wardrobe.`
      })
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "AI classification failed");

    updateQueue(item.localId, {
      status: "done",
      message: "Classified",
      item: payload.item as WardrobeItem
    });
  }

  async function processAll() {
    setError("");
    setProcessing(true);

    try {
      const ready = queue.filter((item) => item.status === "ready" || item.status === "error");
      if (ready.length > 15) {
        setError("Processing the first 15 ready photos only. Keep the rest queued, then run again after this batch finishes.");
      }

      for (const item of ready.slice(0, 15)) {
        try {
          await uploadAndClassify(item);
        } catch (err) {
          updateQueue(item.localId, {
            status: "error",
            message: err instanceof Error ? err.message : "Upload/classification failed"
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk upload failed");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <span className="badge">Upload assistant</span>
        <h1>Bulk upload your wardrobe.</h1>
        <p>
          Upload into the active profile only. Manny and Yess now have separate wardrobes, body references, saved stylist sessions and try-on previews.
        </p>

        <div className="profile-context-card">
          <strong>Uploading for: {activeProfile?.display_name || "Choose profile"}</strong>
          <span>{activeProfile?.style_profile || "Run the profile migration first if no profile appears."}</span>
        </div>

        <div className="form">
          <label>
            Bulk photos
            <input type="file" accept="image/*" multiple onChange={onFiles} disabled={!activeProfileId || processing || loadingProfiles} />
          </label>

          <label>
            AI context
            <textarea
              value={extraContext}
              onChange={(event) => setExtraContext(event.target.value)}
              placeholder="Optional: tell the classifier anything important, e.g. 'these are my brown Chelsea boots from multiple angles' or 'this batch is Yess's work jackets'."
            />
          </label>

          <div className="button-row">
            <button type="button" onClick={processAll} disabled={processing || queue.length === 0 || !activeProfileId}>
              {processing ? "Working through photos..." : `Upload + classify ${queue.filter((item) => item.status === "ready" || item.status === "error").length || queue.length} photo${queue.length === 1 ? "" : "s"}`}
            </button>
            <button type="button" className="secondary-button" onClick={clearDone} disabled={processing || counts.done === 0}>Clear completed</button>
          </div>

          <p className="notice">
            Safe batch size: 10–15 photos. Stay on this Upload screen while upload/classification is running. Upload queue is only the current queue; Wardrobe/database is the source of truth.
          </p>
          <p className="notice">
            Ready {counts.ready} · Uploading {counts.uploading} · Classifying {counts.classifying} · Done {counts.done} · Errors {counts.error}
          </p>
          {profileError && <p className="error">Profile error: {profileError}</p>}
          {error && <p className="error">{error}</p>}
        </div>
      </section>

      {queue.length > 0 && (
        <section className="card">
          <h2>Review queue</h2>
          <div className="grid wide-grid">
            {queue.map((item) => (
              <article className="item-card" key={item.localId}>
                <img src={item.previewUrl} alt={item.file.name} />
                <div className="body">
                  <strong>{item.item?.name || titleFromFile(item.file.name)}</strong>
                  <p>
                    <span className={`status-pill status-${item.status}`}>{item.status}</span>
                  </p>
                  {item.item && (
                    <p>
                      {[item.item.category, item.item.subcategory, item.item.brand, item.item.colour_primary || item.item.colour, item.item.fabric_guess]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  {item.item?.ai_summary && <p>{item.item.ai_summary}</p>}
                  {item.message && <p className={item.status === "error" ? "error" : "muted-small"}>{item.message}</p>}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
