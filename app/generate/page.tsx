"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { WardrobeItem } from "@/lib/types";

export default function GeneratePage() {
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [bodyItemId, setBodyItemId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [occasion, setOccasion] = useState("casual weekend / WFH comfort");
  const [weather, setWeather] = useState("cool Auckland day");
  const [notes, setNotes] = useState("Keep my face and body proportions realistic. Use the selected clothes only.");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("wardrobeAI:dressMeSelection") : null;
    let savedSelection: null | { bodyId?: string; selectedIds?: string[]; occasion?: string; weather?: string; notes?: string } = null;
    if (saved) {
      try { savedSelection = JSON.parse(saved); } catch { savedSelection = null; }
    }

    async function load() {
      const { data, error } = await supabase
        .from("wardrobe_items")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) {
        setError(error.message);
        return;
      }
      const loaded = (data ?? []) as WardrobeItem[];
      setItems(loaded);
      const firstBody = loaded.find((item) => item.category === "body_reference");
      if (savedSelection?.bodyId) setBodyItemId(savedSelection.bodyId);
      else if (firstBody) setBodyItemId(firstBody.id);
      if (savedSelection?.selectedIds?.length) setSelectedIds(savedSelection.selectedIds);
      if (savedSelection?.occasion) setOccasion(savedSelection.occasion);
      if (savedSelection?.weather) setWeather(savedSelection.weather);
      if (savedSelection?.notes) setNotes(savedSelection.notes);
    }
    load();
  }, []);

  const bodyRefs = useMemo(() => items.filter((item) => item.category === "body_reference"), [items]);
  const clothing = useMemo(() => items.filter((item) => item.category !== "body_reference"), [items]);

  function toggleItem(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id]);
  }

  async function generate() {
    setError("");
    setResult("");
    setLoading(true);

    try {
      const body = items.find((item) => item.id === bodyItemId);
      const selected = items.filter((item) => selectedIds.includes(item.id));

      if (!body) throw new Error("Select a body reference photo.");
      if (selected.length === 0) throw new Error("Select at least one clothing item.");

      const response = await fetch("/api/generate-outfit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, selected, occasion, weather, notes })
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Generation failed");
      setResult(payload.imageDataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack">
      <section className="page-header">
        <span className="eyebrow">Virtual try-on</span>
        <h1>Dress me.</h1>
        <p>Select a body reference and clothes. The image agent creates the same kind of realistic preview you liked: your body reference plus the chosen wardrobe pieces.</p>
      </section>

      <section className="card">

      <div className="form">
        <label>
          Body reference
          <select value={bodyItemId} onChange={(event) => setBodyItemId(event.target.value)}>
            <option value="">Choose body reference</option>
            {bodyRefs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>

        <label>
          Occasion
          <input value={occasion} onChange={(event) => setOccasion(event.target.value)} />
        </label>

        <label>
          Weather / vibe
          <input value={weather} onChange={(event) => setWeather(event.target.value)} />
        </label>

        <label>
          Generation notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>

        <div>
          <p>Clothes</p>
          {clothing.length === 0 ? (
            <p className="notice">Upload some clothes first.</p>
          ) : (
            <div className="checkbox-grid">
              {clothing.map((item) => (
                <label className="checkbox-tile" key={item.id}>
                  <img src={item.image_url} alt={item.name} />
                  <span>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => toggleItem(item.id)}
                    />{" "}
                    {item.name}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <button disabled={loading} onClick={generate}>{loading ? "Generating..." : "Generate preview"}</button>
        {error && <p className="error">{error}</p>}
      </div>

      </section>

      {result && (
        <section className="card result-card">
          <span className="eyebrow">Generated preview</span>
          <h2>Your outfit on you</h2>
          <img className="result-image" src={result} alt="Generated outfit preview" />
        </section>
      )}
    </div>
  );
}
