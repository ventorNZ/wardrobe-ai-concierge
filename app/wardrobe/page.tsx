"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useProfiles } from "@/lib/useProfiles";
import type { LaundryStatus, WardrobeCategory, WardrobeItem, WardrobeItemPhoto } from "@/lib/types";
import { categoryLabels, laundryStatuses, wardrobeCategories } from "@/lib/wardrobeTaxonomy";

const formalityLabels = ["very_casual", "casual", "smart_casual", "business_casual", "business", "formal"];

export default function WardrobePage() {
  const { activeProfile, activeProfileId, loadingProfiles, profileError } = useProfiles();
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [category, setCategory] = useState<WardrobeCategory | "all">("all");
  const [laundry, setLaundry] = useState<LaundryStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [formality, setFormality] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [canonicalId, setCanonicalId] = useState("");
  const [mergeMessage, setMergeMessage] = useState("");
  const [mergeWorking, setMergeWorking] = useState(false);

  async function load() {
    if (!activeProfileId) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    const { data, error } = await supabase
      .from("wardrobe_items")
      .select("*")
      .eq("profile_id", activeProfileId)
      .eq("is_archived", false)
      .order("created_at", { ascending: false });

    if (error) setError(error.message);
    else setItems((data ?? []) as WardrobeItem[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!loadingProfiles) {
      setSelectedIds([]);
      setCanonicalId("");
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfileId, loadingProfiles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (laundry !== "all" && item.laundry_status !== laundry) return false;
      if (formality !== "all" && item.formality !== formality) return false;
      if (!q) return true;
      return [item.name, item.brand, item.colour, item.subcategory, item.fabric_guess, item.ai_summary, ...(item.tags ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [items, category, laundry, formality, query]);

  async function updateLaundry(item: WardrobeItem, status: LaundryStatus) {
    const previous = items;
    setItems((current) => current.map((it) => it.id === item.id ? { ...it, laundry_status: status } : it));

    const { error } = await supabase
      .from("wardrobe_items")
      .update({ laundry_status: status, updated_at: new Date().toISOString() })
      .eq("id", item.id);

    if (error) {
      setError(error.message);
      setItems(previous);
    } else {
      await supabase.from("item_status_events").insert({
        owner_id: "demo-user",
        wardrobe_item_id: item.id,
        status
      });
    }
  }

  async function markWorn(item: WardrobeItem) {
    const now = new Date().toISOString();
    const nextWearCount = (item.wear_count ?? 0) + 1;
    setItems((current) => current.map((it) => it.id === item.id ? { ...it, laundry_status: "worn_once", last_worn_at: now, wear_count: nextWearCount } : it));

    const { error } = await supabase
      .from("wardrobe_items")
      .update({ laundry_status: "worn_once", last_worn_at: now, wear_count: nextWearCount, updated_at: now })
      .eq("id", item.id);

    if (error) setError(error.message);
    await supabase.from("item_status_events").insert({ owner_id: "demo-user", wardrobe_item_id: item.id, status: "worn_once" });
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id];
      if (!canonicalId && next.length) setCanonicalId(next[0]);
      if (canonicalId && !next.includes(canonicalId)) setCanonicalId(next[0] || "");
      return next;
    });
  }

  async function mergeSelectedIntoCanonical() {
    setMergeMessage("");
    setError("");
    if (selectedIds.length < 2) {
      setError("Select at least two duplicate items to merge.");
      return;
    }
    if (!canonicalId || !selectedIds.includes(canonicalId)) {
      setError("Choose which selected item should stay visible as the canonical item.");
      return;
    }

    const duplicates = selectedIds.filter((id) => id !== canonicalId);
    const selectedItems = items.filter((item) => selectedIds.includes(item.id));
    const duplicateItems = selectedItems.filter((item) => item.id !== canonicalId);
    const canonicalItem = selectedItems.find((item) => item.id === canonicalId);
    if (!canonicalItem) return;

    setMergeWorking(true);
    try {
      const { data: existingPhotos, error: photoError } = await supabase
        .from("wardrobe_item_photos")
        .select("*")
        .in("wardrobe_item_id", selectedIds);

      if (photoError) throw photoError;

      const rowsToInsert: Array<Partial<WardrobeItemPhoto>> = [];
      const addPhoto = (sourceItem: WardrobeItem, imageUrl?: string | null, storagePath?: string | null, angleLabel = "merged-angle") => {
        if (!imageUrl) return;
        const alreadyAdded = rowsToInsert.some((row) => row.image_url === imageUrl);
        if (alreadyAdded) return;
        rowsToInsert.push({
          wardrobe_item_id: canonicalId,
          image_url: imageUrl,
          storage_path: storagePath || null,
          source_item_id: sourceItem.id,
          angle_label: angleLabel,
          is_primary: sourceItem.id === canonicalId
        });
      };

      // Ensure the canonical's current photo exists in the multi-angle table too.
      addPhoto(canonicalItem, canonicalItem.image_url, canonicalItem.storage_path, "primary");

      for (const photo of (existingPhotos ?? []) as WardrobeItemPhoto[]) {
        const source = selectedItems.find((item) => item.id === (photo.source_item_id || photo.wardrobe_item_id)) || selectedItems.find((item) => item.id === photo.wardrobe_item_id);
        if (source) addPhoto(source, photo.image_url, photo.storage_path, photo.angle_label || "merged-angle");
      }

      for (const duplicate of duplicateItems) {
        addPhoto(duplicate, duplicate.image_url, duplicate.storage_path, "merged-angle");
      }

      if (rowsToInsert.length) {
        const { error: insertError } = await supabase.from("wardrobe_item_photos").insert(rowsToInsert);
        if (insertError && !insertError.message.toLowerCase().includes("duplicate")) throw insertError;
      }

      const { error: archiveError } = await supabase
        .from("wardrobe_items")
        .update({
          is_archived: true,
          canonical_item_id: canonicalId,
          updated_at: new Date().toISOString()
        })
        .in("id", duplicates);

      if (archiveError) throw archiveError;

      const { count } = await supabase
        .from("wardrobe_item_photos")
        .select("id", { count: "exact", head: true })
        .eq("wardrobe_item_id", canonicalId);

      const { error: countError } = await supabase
        .from("wardrobe_items")
        .update({ angle_count: Math.max(count ?? rowsToInsert.length, 1), updated_at: new Date().toISOString() })
        .eq("id", canonicalId);

      if (countError) throw countError;

      setMergeMessage(`Merged ${duplicates.length} duplicate item${duplicates.length === 1 ? "" : "s"} into ${canonicalItem.name}.`);
      setSelectedIds([]);
      setCanonicalId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setMergeWorking(false);
    }
  }

  const categoryCounts = useMemo(() => {
    return wardrobeCategories.map((cat) => ({
      category: cat,
      count: items.filter((item) => item.category === cat).length
    }));
  }, [items]);

  return (
    <div className="stack">
      <section className="page-header">
        <span className="eyebrow">Wardrobe intelligence</span>
        <h1>The closet index.</h1>
        <p>
          Showing active profile: <strong>{activeProfile?.display_name || "Choose profile"}</strong>. Archived duplicates are hidden from Wardrobe, Stylist and Dress Me.
        </p>
      </section>

      <section className="stats-grid">
        {categoryCounts.map((entry) => (
          <div className="stat-card" key={entry.category}>
            <strong>{entry.count}</strong>
            <span>{categoryLabels[entry.category]}</span>
          </div>
        ))}
      </section>

      <section className="card controls-card">
        <div className="filters">
          <label>
            Search
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="navy, blazer, leather, client..." />
          </label>
          <label>
            Category
            <select value={category} onChange={(event) => setCategory(event.target.value as WardrobeCategory | "all")}>
              <option value="all">All categories</option>
              {wardrobeCategories.map((cat) => <option key={cat} value={cat}>{categoryLabels[cat]}</option>)}
            </select>
          </label>
          <label>
            Laundry
            <select value={laundry} onChange={(event) => setLaundry(event.target.value as LaundryStatus | "all")}>
              <option value="all">All laundry states</option>
              {laundryStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
            </select>
          </label>
          <label>
            Formality
            <select value={formality} onChange={(event) => setFormality(event.target.value)}>
              <option value="all">All formality levels</option>
              {formalityLabels.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="card merge-panel">
        <span className="eyebrow dark">Multi-angle merge</span>
        <h2 className="section-h2">Turn duplicate photos into one item.</h2>
        <p>Select photos of the same item, choose the best canonical item, then merge. Duplicates are archived and their photos become extra angles on the canonical item.</p>
        <div className="button-row">
          <label className="compact-select">
            Keep visible item
            <select value={canonicalId} onChange={(event) => setCanonicalId(event.target.value)} disabled={selectedIds.length === 0}>
              <option value="">Choose canonical item</option>
              {selectedIds.map((id) => {
                const item = items.find((entry) => entry.id === id);
                return item ? <option key={id} value={id}>{item.name}</option> : null;
              })}
            </select>
          </label>
          <button type="button" onClick={mergeSelectedIntoCanonical} disabled={mergeWorking || selectedIds.length < 2}>
            {mergeWorking ? "Merging..." : `Merge ${selectedIds.length} selected`}
          </button>
          <button type="button" className="secondary-button" onClick={() => { setSelectedIds([]); setCanonicalId(""); }} disabled={mergeWorking || selectedIds.length === 0}>Clear selection</button>
        </div>
        {mergeMessage && <p className="notice">{mergeMessage}</p>}
      </section>

      {profileError && <p className="error">Profile error: {profileError}</p>}
      {error && <p className="error">{error}</p>}
      {loading ? <p className="notice">Loading wardrobe...</p> : null}

      <section className="grid wardrobe-grid">
        {filtered.map((item) => (
          <article className={`item-card wardrobe-card ${selectedIds.includes(item.id) ? "is-selected" : ""}`} key={item.id}>
            <div className="select-strip">
              <label>
                <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelected(item.id)} />
                Select for merge
              </label>
            </div>
            <img src={item.image_url} alt={item.name} />
            <div className="body">
              <div className="card-kicker">
                <span className="status-pill status-classified">{item.category}</span>
                <span className="status-pill status-ready">{item.laundry_status?.replaceAll("_", " ") || "clean"}</span>
                {(item.angle_count ?? 1) > 1 ? <span className="status-pill status-ready">{item.angle_count} angles</span> : null}
              </div>
              <strong>{item.name}</strong>
              <p>{[item.subcategory, item.brand, item.colour_primary || item.colour, item.fabric_guess].filter(Boolean).join(" · ")}</p>
              <p className="muted-small">
                Formality {item.formality_score ?? "?"}/10 · Warmth {item.warmth_score ?? "?"}/10 · Worn {item.wear_count ?? 0}x
              </p>
              {item.ai_summary && <p>{item.ai_summary}</p>}
              <div className="tag-row">
                {(item.style_tags ?? item.tags ?? []).slice(0, 6).map((tag) => <span className="mini-tag" key={tag}>{tag}</span>)}
              </div>
              <div className="button-row compact-buttons">
                <button type="button" className="secondary-button" onClick={() => markWorn(item)}>Wore today</button>
                <select value={item.laundry_status || "clean"} onChange={(event) => updateLaundry(item, event.target.value as LaundryStatus)}>
                  {laundryStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
                </select>
              </div>
            </div>
          </article>
        ))}
      </section>

      {!loading && filtered.length === 0 && <p className="notice">No wardrobe items match those filters for {activeProfile?.display_name || "this profile"}.</p>}
    </div>
  );
}
