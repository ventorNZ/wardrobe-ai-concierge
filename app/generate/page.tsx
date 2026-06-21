"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useProfiles } from "@/lib/useProfiles";
import type { DressMeSession, WardrobeItem } from "@/lib/types";
import { nzNowLabel, nzTodayIso } from "@/lib/nzTime";

type SavedSelection = {
  profileId?: string;
  selectedDate?: string;
  lookLabel?: string;
  bodyId?: string;
  selectedIds?: string[];
  occasion?: string;
  weather?: string;
  notes?: string;
};

function selectionKey(profileId: string, dateIso: string) {
  return `wardrobeAI:dressMeSelection:${profileId || "demo"}:${dateIso}`;
}

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || `HTTP ${response.status}` };
  }
}

const categoryTabs = ["all", "top", "bottom", "shoes", "outerwear", "accessory", "other"];

export default function GeneratePage() {
  const { activeProfile, activeProfileId, loadingProfiles, profileError } = useProfiles();
  const todayIso = nzTodayIso();
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [bodyItemId, setBodyItemId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [occasion, setOccasion] = useState("Today’s saved stylist look");
  const [weather, setWeather] = useState("Use the saved stylist/weather context for today.");
  const [notes, setNotes] = useState("Keep my face and body proportions realistic. Use the selected clothes only.");
  const [result, setResult] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sessionDate, setSessionDate] = useState(todayIso);
  const [nzClockLabel, setNzClockLabel] = useState(nzNowLabel());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  const draftKey = `wardrobeAI:dressMeDraft:${activeProfileId}:${sessionDate}`;

  useEffect(() => {
    const handle = window.setInterval(() => setNzClockLabel(nzNowLabel()), 60_000);
    setNzClockLabel(nzNowLabel());
    return () => window.clearInterval(handle);
  }, []);

  useEffect(() => {
    if (!activeProfileId || loadingProfiles) return;
    async function load() {
      setError("");
      setResult("");
      setSessionId("");
      const { data, error } = await supabase
        .from("wardrobe_items")
        .select("*")
        .eq("profile_id", activeProfileId)
        .eq("is_archived", false)
        .order("created_at", { ascending: false });
      if (error) {
        setError(error.message);
        return;
      }

      const loaded = (data ?? []) as WardrobeItem[];
      setItems(loaded);
      const firstBody = loaded.find((item) => item.category === "body_reference");

      let savedSelection: SavedSelection | null = null;
      const saved = localStorage.getItem(selectionKey(activeProfileId, sessionDate)) || localStorage.getItem("wardrobeAI:dressMeSelection");
      if (saved) {
        try { savedSelection = JSON.parse(saved) as SavedSelection; } catch { savedSelection = null; }
      }
      if (savedSelection?.profileId && savedSelection.profileId !== activeProfileId) savedSelection = null;

      let local: Partial<DressMeSession> & { bodyId?: string; selectedIds?: string[]; lastOutputDataUrl?: string } = {};
      const localRaw = localStorage.getItem(draftKey);
      if (localRaw) {
        try { local = JSON.parse(localRaw); } catch { local = {}; }
      }

      const { data: dbSession } = await supabase
        .from("dress_me_sessions")
        .select("*")
        .eq("profile_id", activeProfileId)
        .eq("selected_date", sessionDate)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const session = (dbSession as DressMeSession | null) || null;
      if (session?.id) setSessionId(session.id);

      const nextBody = savedSelection?.bodyId || session?.body_item_id || local.body_item_id || local.bodyId || firstBody?.id || "";
      const nextSelected = savedSelection?.selectedIds || session?.selected_item_ids || local.selected_item_ids || local.selectedIds || [];
      setBodyItemId(nextBody && loaded.some((item) => item.id === nextBody) ? nextBody : firstBody?.id || "");
      setSelectedIds(nextSelected.filter((id) => loaded.some((item) => item.id === id && item.category !== "body_reference")).slice(0, 7));
      setOccasion(savedSelection?.occasion || session?.occasion || local.occasion || "Today’s saved stylist look");
      setWeather(savedSelection?.weather || session?.weather_summary || local.weather_summary || "Use the saved stylist/weather context for today.");
      setNotes(savedSelection?.notes || session?.notes || local.notes || "Keep my face and body proportions realistic. Use the selected clothes only.");
      setResult(session?.last_output_data_url || local.last_output_data_url || local.lastOutputDataUrl || "");
    }
    void load();
  }, [activeProfileId, draftKey, loadingProfiles, sessionDate]);

  const bodyRefs = useMemo(() => items.filter((item) => item.category === "body_reference"), [items]);
  const clothing = useMemo(() => items.filter((item) => item.category !== "body_reference"), [items]);
  const selectedItems = useMemo(() => selectedIds.map((id) => items.find((item) => item.id === id)).filter(Boolean) as WardrobeItem[], [items, selectedIds]);
  const bodyRef = bodyRefs.find((item) => item.id === bodyItemId) || bodyRefs[0] || null;
  const filteredClothing = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clothing
      .filter((item) => category === "all" || item.category === category)
      .filter((item) => {
        if (!q) return true;
        return [item.name, item.category, item.subcategory, item.brand, item.colour_primary || item.colour, item.fabric_guess, ...(item.tags ?? [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .slice(0, 36);
  }, [clothing, category, query]);

  async function persistDraft(nextResult = result) {
    if (!activeProfileId) return;
    const payload = {
      owner_id: "demo-user",
      profile_id: activeProfileId,
      selected_date: sessionDate,
      body_item_id: bodyItemId || null,
      selected_item_ids: selectedIds,
      occasion: occasion || null,
      weather_summary: weather || null,
      notes: notes || null,
      last_output_data_url: nextResult || null,
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem(draftKey, JSON.stringify(payload));
    setSaving(true);
    try {
      const saved = sessionId
        ? await supabase.from("dress_me_sessions").update(payload).eq("id", sessionId).select("id").single()
        : await supabase.from("dress_me_sessions").insert(payload).select("id").single();
      if (!saved.error && saved.data?.id) setSessionId(saved.data.id as string);
    } finally {
      setSaving(false);
    }
  }

  function toggleItem(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id].slice(0, 7));
  }

  async function generate() {
    setError("");
    setResult("");
    setLoading(true);
    try {
      const body = bodyRef || items.find((item) => item.id === bodyItemId);
      const selected = items.filter((item) => selectedIds.includes(item.id));
      if (!body) throw new Error("Add or select a body reference photo first.");
      if (selected.length === 0) throw new Error("Open Stylist first or choose a small outfit manually.");

      const response = await fetch("/api/generate-outfit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: activeProfileId, body, selected, occasion, weather, notes }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(payload.error || "Generation failed");
      if (!payload.imageDataUrl) throw new Error("Generation completed but returned no image.");
      setResult(payload.imageDataUrl);
      await persistDraft(payload.imageDataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-shell ux-page">
      <section className="ux-hero card">
        <div>
          <span className="eyebrow">Try-on</span>
          <h1>{selectedItems.length ? "Try this outfit" : "Pick an outfit to preview"}</h1>
          <p className="lead-copy">Start with the stylist look, or pick your own pieces. The closet stays hidden until you ask for it.</p>
        </div>
        <div className="ux-status-card">
          <strong>{activeProfile?.display_name || "Profile"}</strong>
          <span>{nzClockLabel} NZ</span>
          <small>{saving ? "saving…" : "saved for today"}</small>
        </div>
      </section>

      <section className="tryon-grid">
        <div className="card tryon-command-card">
          <div className="body-reference-strip">
            {bodyRef ? <img src={bodyRef.image_url} alt={bodyRef.name} /> : <div className="blank-avatar">＋</div>}
            <div>
              <strong>{bodyRef?.name || "No body reference"}</strong>
              <span>{occasion}</span>
            </div>
          </div>

          {selectedItems.length ? (
            <div className="selected-outfit-grid">
              {selectedItems.map((item) => (
                <article className="selected-outfit-tile" key={item.id}>
                  <img src={item.image_url} alt={item.name} />
                  <strong>{item.name}</strong>
                  <span>{item.category}</span>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state-card mini-empty">
              <h2>No outfit selected yet.</h2>
              <p>Choose a stylist look, or tap “Pick my own outfit” to build one manually.</p>
              <a className="primary-button" href="/planner">Open Stylist</a>
            </div>
          )}

          <div className="details-fold">
            <label>
              <span>Body reference</span>
              <select value={bodyRef?.id || bodyItemId} onChange={(event) => setBodyItemId(event.target.value)}>
                <option value="">Choose body reference</option>
                {bodyRefs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label><span>Occasion</span><input value={occasion} onChange={(event) => setOccasion(event.target.value)} /></label>
            <label><span>Weather / vibe</span><input value={weather} onChange={(event) => setWeather(event.target.value)} /></label>
            <label><span>Generation notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} /></label>
          </div>

          <div className="button-row wrap-buttons">
            <button type="button" className="primary-button" disabled={loading || !activeProfileId || !selectedItems.length} onClick={generate}>
              {loading ? "Generating preview…" : result ? "Regenerate preview" : "Generate preview"}
            </button>
            <button type="button" className="secondary-button" onClick={() => setManualOpen((open) => !open)}>
              {manualOpen ? "Done picking" : "Pick my own outfit"}
            </button>
          </div>
          {profileError ? <p className="error">Profile error: {profileError}</p> : null}
          {error ? <p className="error">{error}</p> : null}
        </div>

        <aside className="card tryon-result-card">
          {result ? <img className="result-image" src={result} alt="Generated outfit preview" /> : <div className="result-placeholder"><span>✦</span><strong>Preview appears here</strong><small>No fake body reference placeholder, no background text.</small></div>}
        </aside>
      </section>

      {manualOpen ? (
        <section className="card manual-picker-card">
          <div className="section-heading-row">
            <div><span className="eyebrow dark">Manual outfit</span><h2>Pick your own outfit.</h2></div>
          </div>
          <div className="visual-filter-toolbar">
            <div className="tab-row">
              {categoryTabs.map((tab) => <button key={tab} type="button" className={category === tab ? "tab active" : "tab"} onClick={() => setCategory(tab)}>{tab}</button>)}
            </div>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search closet" />
          </div>
          <div className="visual-picker-grid">
            {filteredClothing.map((item) => (
              <button key={item.id} type="button" className={selectedIds.includes(item.id) ? "picker-tile selected" : "picker-tile"} onClick={() => toggleItem(item.id)}>
                <img src={item.image_url} alt={item.name} />
                <span>{item.name}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
