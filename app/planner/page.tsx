"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { WardrobeItem } from "@/lib/types";

type OutfitPlan = {
  label: string;
  item_ids: string[];
  summary: string;
  why_it_works: string;
  watch_outs: string[];
  formality_score: number;
  warmth_score: number;
};

type Recommendation = {
  day_brief: string;
  stylist_positioning: string;
  outfits: OutfitPlan[];
  missing_info: string[];
};

const weekdayOptions = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function PlannerPage() {
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [bodyId, setBodyId] = useState("");
  const [selectedDay, setSelectedDay] = useState("Monday");
  const [dayContext, setDayContext] = useState("08:30 School run · 10:00 Board call on camera · 13:00 Investor 1:1 on camera. Modern executive, calm, not stiff.");
  const [weather, setWeather] = useState("11°C to 6°C, showers clearing, light wind, about 25 minutes outside.");
  const [vibe, setVibe] = useState("Camera-first morning, polished, approachable, weather-smart.");
  const [result, setResult] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase.from("wardrobe_items").select("*").order("created_at", { ascending: false });
      if (!error) {
        const loaded = (data ?? []) as WardrobeItem[];
        setItems(loaded);
        const firstBody = loaded.find((item) => item.category === "body_reference");
        if (firstBody) setBodyId(firstBody.id);
      } else setError(error.message);
    }
    load();
  }, []);

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const bodyRefs = useMemo(() => items.filter((item) => item.category === "body_reference"), [items]);
  const bodyRef = bodyRefs.find((item) => item.id === bodyId) || bodyRefs[0] || null;

  const wardrobeState = useMemo(() => {
    const clothing = items.filter((item) => item.category !== "body_reference");
    return {
      clean: clothing.filter((item) => (item.laundry_status || "clean") === "clean").length,
      rewear: clothing.filter((item) => ["rewear_ok", "worn_once"].includes(item.laundry_status || "")).length,
      inWash: clothing.filter((item) => ["needs_wash", "drying"].includes(item.laundry_status || "")).length
    };
  }, [items]);

  async function recommend() {
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const response = await fetch("/api/recommend-outfits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dayContext, weather, vibe })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Recommendation failed");
      setResult(payload.recommendation as Recommendation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recommendation failed");
    } finally {
      setLoading(false);
    }
  }

  function useInDressMe(outfit: OutfitPlan) {
    localStorage.setItem(
      "wardrobeAI:dressMeSelection",
      JSON.stringify({
        bodyId,
        selectedIds: outfit.item_ids,
        occasion: `${selectedDay}: ${dayContext}`,
        weather,
        notes: `${outfit.summary}\n\n${outfit.why_it_works}\nUse the real body reference and selected accessories. Preserve identity.`
      })
    );
    window.location.href = "/generate";
  }

  const scheduleRows = dayContext
    .split(/[\n·]/)
    .map((row) => row.trim())
    .filter(Boolean)
    .slice(0, 4);

  return (
    <div className="stack">
      <section className="planner-shell card">
        <div className="planner-intro">
          <div className="planner-heading">
            <div className="spark-mark">✦</div>
            <div>
              <h1 className="planner-title">The Wardrobe</h1>
              <p className="planner-subtitle">Two looks for today, worn and explained.</p>
            </div>
          </div>

          <div className="chip-group">
            {weekdayOptions.map((day) => (
              <button
                type="button"
                key={day}
                className={`seg-chip ${selectedDay === day ? "is-active" : ""}`}
                onClick={() => setSelectedDay(day)}
              >
                {day}
              </button>
            ))}
          </div>
        </div>

        <div className="planner-two-col">
          <div className="planner-form card inset-card">
            <span className="eyebrow dark">Today</span>
            <h2 className="section-h2">Brief the stylist.</h2>
            <div className="form">
              <label>
                Body reference photo
                <select value={bodyId} onChange={(event) => setBodyId(event.target.value)}>
                  <option value="">Choose body reference</option>
                  {bodyRefs.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Day context / schedule
                <textarea value={dayContext} onChange={(event) => setDayContext(event.target.value)} />
              </label>
              <label>
                Weather / outside time
                <input value={weather} onChange={(event) => setWeather(event.target.value)} />
              </label>
              <label>
                Desired vibe
                <input value={vibe} onChange={(event) => setVibe(event.target.value)} />
              </label>
              <div className="button-row">
                <button type="button" onClick={recommend} disabled={loading}>{loading ? "Stylist is thinking..." : "Recommend looks"}</button>
                <a className="ghost-link" href="/wardrobe">Wardrobe</a>
              </div>
              {error ? <p className="error">{error}</p> : null}
            </div>
          </div>

          <aside className="day-brief card inset-card">
            <span className="eyebrow dark">Today</span>
            <h2 className="day-date">{selectedDay}</h2>
            <p className="weather-line">{weather}</p>
            <div className="weather-chip-row">
              <span className="small-chip">meetings aware</span>
              <span className="small-chip">camera aware</span>
              <span className="small-chip">weather aware</span>
            </div>
            <div className="divider" />
            <div className="schedule-list">
              <span className="section-label">Schedule</span>
              {scheduleRows.length ? scheduleRows.map((row) => <p key={row}>{row}</p>) : <p>Add your schedule in the day context field.</p>}
            </div>
            <div className="divider" />
            <div className="schedule-list">
              <span className="section-label">Read</span>
              <p>
                Dressing to your professional profile: modern executive, polished, camera-friendly, and practical for Auckland conditions. Outer layer only when the day really asks for it.
              </p>
            </div>
            <div className="divider" />
            <div className="wardrobe-state-panel">
              <span className="section-label">Wardrobe state</span>
              <div className="wardrobe-state-row">
                <span className="laundry-pill is-clean">{wardrobeState.clean} clean</span>
                <span className="laundry-pill is-rewear">{wardrobeState.rewear} re-wear</span>
                <span className="laundry-pill is-wash">{wardrobeState.inWash} in wash</span>
              </div>
            </div>
          </aside>
        </div>
      </section>

      {result ? (
        <section className="stack">
          <section className="card recommendation-header">
            <span className="eyebrow dark">Stylist read</span>
            <h2 className="section-h2">{result.stylist_positioning}</h2>
            <p>{result.day_brief}</p>
            {result.missing_info?.length ? <p className="notice">Missing info: {result.missing_info.join(", ")}</p> : null}
          </section>

          {result.outfits.map((outfit, index) => {
            const lookLabel = String.fromCharCode(65 + index);
            const outfitItems = outfit.item_ids
              .map((id) => byId.get(id))
              .filter(Boolean) as WardrobeItem[];

            return (
              <article className="look-layout card" key={`${outfit.label}-${index}`}>
                <div className="look-preview-frame">
                  <span className="section-label">On you</span>
                  {bodyRef ? (
                    <img className="body-preview-image" src={bodyRef.image_url} alt={bodyRef.name} />
                  ) : (
                    <div className="body-preview-empty">Upload a body reference to preview realistic looks on yourself.</div>
                  )}
                </div>

                <div className="look-copy">
                  <span className="section-label">Look {lookLabel}</span>
                  <h3 className="look-name">{outfit.summary}</h3>
                  <div className="look-meta-row">
                    <span className="small-chip">formality {outfit.formality_score}/10</span>
                    <span className="small-chip">warmth {outfit.warmth_score}/10</span>
                  </div>

                  <div className="items-grid-lite">
                    {outfitItems.map((item) => (
                      <article className="mini-item-card" key={item.id}>
                        <img src={item.image_url} alt={item.name} />
                        <div>
                          <strong>{item.name}</strong>
                          <span>{(item.category || "item").replaceAll("_", " ")}</span>
                        </div>
                      </article>
                    ))}
                  </div>

                  <blockquote className="style-read">{outfit.why_it_works}</blockquote>
                  {outfit.watch_outs?.length ? <p className="muted-small">Watch outs: {outfit.watch_outs.join(" · ")}</p> : null}

                  <div className="button-row">
                    <button type="button" onClick={() => useInDressMe(outfit)} disabled={!bodyId}>Preview on me</button>
                    <a className="secondary-button" href="/generate">Open Dress Me</a>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="card empty-state-card">
          <span className="eyebrow dark">Next</span>
          <h2 className="section-h2">Get the AI stylist to suggest complete looks.</h2>
          <p>
            Once you tap <strong>Recommend looks</strong>, the planner will pick items from your uploaded wardrobe based on your day, weather, laundry state and the professional styling profile we defined.
          </p>
        </section>
      )}
    </div>
  );
}
