"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
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
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [extraContext, setExtraContext] = useState("Classify these for Manuel's real wardrobe: executive work, online meetings, candidate interviews, client/supplier meetings, WFH, weekend, Auckland weather.");
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
  }

  function updateQueue(localId: string, patch: Partial<QueueItem>) {
    setQueue((current) => current.map((item) => item.localId === localId ? { ...item, ...patch } : item));
  }

  function clearDone() {
    setQueue((current) => current.filter((item) => item.status !== "done"));
  }

  async function uploadAndClassify(item: QueueItem) {
    updateQueue(item.localId, { status: "uploading", message: "Uploading photo..." });

    const ext = item.file.name.split(".").pop() || "jpg";
    const path = `demo-user/uploads/${Date.now()}-${safeFileName(item.file.name)}.${ext}`;

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
        name: titleFromFile(item.file.name),
        category: "other",
        image_url: imageUrl,
        storage_path: path,
        classification_status: "queued",
        laundry_status: "clean",
        tags: []
      })
      .select("*")
      .single();

    if (insert.error) throw insert.error;
    updateQueue(item.localId, { item: insert.data as WardrobeItem, status: "classifying", message: "AI is identifying category, colour, brand, fabric and styling tags..." });

    const response = await fetch("/api/classify-wardrobe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: insert.data.id, extraContext })
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
      for (const item of ready) {
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
          Select 30+ photos from your iPhone/iCloud folder. The app uploads them, then the AI classifies each item: type, colour, brand, fabric guess, season, formality, warmth and styling tags.
        </p>

        <div className="form">
          <label>
            Bulk photos
            <input type="file" accept="image/*" multiple onChange={onFiles} />
          </label>

          <label>
            AI context
            <textarea value={extraContext} onChange={(event) => setExtraContext(event.target.value)} />
          </label>

          <div className="button-row">
            <button type="button" onClick={processAll} disabled={processing || queue.length === 0}>
              {processing ? "Working through photos..." : `Upload + classify ${queue.filter((item) => item.status === "ready" || item.status === "error").length || queue.length} photo${queue.length === 1 ? "" : "s"}`}
            </button>
            <button type="button" className="secondary-button" onClick={clearDone} disabled={processing || counts.done === 0}>Clear completed</button>
          </div>

          <p className="notice">
            Ready {counts.ready} · Uploading {counts.uploading} · Classifying {counts.classifying} · Done {counts.done} · Errors {counts.error}
          </p>
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
