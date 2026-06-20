"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { LaundryStatus, WardrobeCategory, WardrobeItem } from "@/lib/types";
import { categoryLabels, laundryStatuses, wardrobeCategories } from "@/lib/wardrobeTaxonomy";

const formalityLabels = ["very_casual", "casual", "smart_casual", "business_casual", "business", "formal"];

export default function WardrobePage() {
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [category, setCategory] = useState<WardrobeCategory | "all">("all");
  const [laundry, setLaundry] = useState<LaundryStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [formality, setFormality] = useState("all");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("wardrobe_items")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) setError(error.message);
    else setItems((data ?? []) as WardrobeItem[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

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
          AI-classified garments, laundry state, style attributes, warmth, formality and fit notes — ready for the stylist agent to dress you.
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

      {error && <p className="error">{error}</p>}
      {loading ? <p className="notice">Loading wardrobe...</p> : null}

      <section className="grid wardrobe-grid">
        {filtered.map((item) => (
          <article className="item-card wardrobe-card" key={item.id}>
            <img src={item.image_url} alt={item.name} />
            <div className="body">
              <div className="card-kicker">
                <span className="status-pill status-classified">{item.category}</span>
                <span className="status-pill status-ready">{item.laundry_status?.replaceAll("_", " ") || "clean"}</span>
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

      {!loading && filtered.length === 0 && <p className="notice">No wardrobe items match those filters.</p>}
    </div>
  );
}
