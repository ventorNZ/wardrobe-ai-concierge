"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useProfiles } from "@/lib/useProfiles";
import type { DressMeSession, WardrobeItem } from "@/lib/types";
import { nzNowLabel, nzTodayIso } from "@/lib/nzTime";

function getSpeechRecognition() {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => any;
    webkitSpeechRecognition?: new () => any;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export default function GeneratePage() {
  const { activeProfile, activeProfileId, loadingProfiles, profileError } = useProfiles();
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [bodyItemId, setBodyItemId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [occasion, setOccasion] = useState("");
  const [weather, setWeather] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sessionDate, setSessionDate] = useState(nzTodayIso());
  const [nzClockLabel, setNzClockLabel] = useState(nzNowLabel());
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [speechActive, setSpeechActive] = useState(false);
  const [error, setError] = useState("");
  const todayRef = useRef(nzTodayIso());

  const draftKey = `wardrobeAI:dressMeDraft:${activeProfileId}:${sessionDate}`;

  useEffect(() => {
    const handle = window.setInterval(() => {
      const today = nzTodayIso();
      setNzClockLabel(nzNowLabel());
      if (today !== todayRef.current) {
        setSessionDate((current) => current === todayRef.current ? today : current);
        todayRef.current = today;
      }
    }, 60_000);

    setNzClockLabel(nzNowLabel());
    return () => window.clearInterval(handle);
  }, []);

  useEffect(() => {
    if (!activeProfileId || loadingProfiles) return;

    async function load() {
      setHydrated(false);
      setError("");
      setSessionId("");
      setResult("");

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

      const savedSelectionRaw = typeof window !== "undefined" ? localStorage.getItem("wardrobeAI:dressMeSelection") : null;
      let savedSelection: null | { profileId?: string; selectedDate?: string; bodyId?: string; selectedIds?: string[]; occasion?: string; weather?: string; notes?: string } = null;
      if (savedSelectionRaw) {
        try { savedSelection = JSON.parse(savedSelectionRaw); } catch { savedSelection = null; }
      }

      const localRaw = localStorage.getItem(draftKey);
      let local: Partial<DressMeSession> & { bodyId?: string; selectedIds?: string[]; weather?: string; lastOutputDataUrl?: string } = {};
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

      const sameDaySelection = savedSelection?.profileId === activeProfileId && (!savedSelection.selectedDate || savedSelection.selectedDate === sessionDate)
        ? savedSelection
        : null;
      const session = (dbSession as DressMeSession | null) || null;

      const nextBody = sameDaySelection?.bodyId || session?.body_item_id || local.body_item_id || local.bodyId || firstBody?.id || "";
      const nextSelectedIds = sameDaySelection?.selectedIds || session?.selected_item_ids || local.selected_item_ids || local.selectedIds || [];
      const nextOccasion = sameDaySelection?.occasion || session?.occasion || local.occasion || "";
      const nextWeather = sameDaySelection?.weather || session?.weather_summary || local.weather_summary || local.weather || "";
      const nextNotes = sameDaySelection?.notes || session?.notes || local.notes || "";
      const nextResult = session?.last_output_data_url || local.last_output_data_url || local.lastOutputDataUrl || "";

      if (session?.id) setSessionId(session.id);
      setBodyItemId(nextBody && loaded.some((item) => item.id === nextBody) ? nextBody : firstBody?.id || "");
      setSelectedIds(nextSelectedIds.filter((id) => loaded.some((item) => item.id === id && item.category !== "body_reference")));
      setOccasion(nextOccasion);
      setWeather(nextWeather);
      setNotes(nextNotes);
      setResult(nextResult);
      setHydrated(true);
    }

    void load();
  }, [activeProfileId, draftKey, loadingProfiles, sessionDate]);

  const persistDraft = useCallback(async () => {
    if (!activeProfileId || !hydrated) return;
    const payload = {
      owner_id: "demo-user",
      profile_id: activeProfileId,
      selected_date: sessionDate,
      body_item_id: bodyItemId || null,
      selected_item_ids: selectedIds,
      occasion: occasion || null,
      weather_summary: weather || null,
      notes: notes || null,
      last_output_data_url: result || null,
      updated_at: new Date().toISOString()
    };

    localStorage.setItem(draftKey, JSON.stringify(payload));
    setSaving(true);
    const saved = sessionId
      ? await supabase.from("dress_me_sessions").update(payload).eq("id", sessionId).select("id").single()
      : await supabase.from("dress_me_sessions").insert(payload).select("id").single();
    setSaving(false);

    if (!saved.error && saved.data?.id) setSessionId(saved.data.id as string);
  }, [activeProfileId, bodyItemId, draftKey, hydrated, notes, occasion, result, selectedIds, sessionDate, sessionId, weather]);

  useEffect(() => {
    if (!hydrated || !activeProfileId) return;
    const handle = window.setTimeout(() => {
      void persistDraft();
    }, 900);
    return () => window.clearTimeout(handle);
  }, [activeProfileId, hydrated, persistDraft]);

  const bodyRefs = useMemo(() => items.filter((item) => item.category === "body_reference"), [items]);
  const clothing = useMemo(() => items.filter((item) => item.category !== "body_reference"), [items]);

  function toggleItem(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id]);
  }

  function startVoiceNotes() {
    setError("");
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      setError("Voice input is not available in this browser. Try Safari/Chrome on iPhone or desktop Chrome.");
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "en-NZ";
    recognition.interimResults = false;
    recognition.continuous = false;
    setSpeechActive(true);
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0]?.transcript)
        .filter(Boolean)
        .join(" ")
        .trim();
      if (transcript) setNotes((current) => [current, transcript].filter(Boolean).join(current ? "\n" : ""));
    };
    recognition.onerror = () => setError("Voice input stopped before capturing text.");
    recognition.onend = () => setSpeechActive(false);
    recognition.start();
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
        body: JSON.stringify({
          profileId: activeProfileId,
          body,
          selected,
          occasion,
          weather,
          notes: notes || "Use selected clothes only. Preserve identity and body proportions."
        })
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Generation failed");
      setResult(payload.imageDataUrl);

      const nextPayload = {
        owner_id: "demo-user",
        profile_id: activeProfileId,
        selected_date: sessionDate,
        body_item_id: bodyItemId || null,
        selected_item_ids: selectedIds,
        occasion: occasion || null,
        weather_summary: weather || null,
        notes: notes || null,
        last_output_data_url: payload.imageDataUrl || null,
        updated_at: new Date().toISOString()
      };
      localStorage.setItem(draftKey, JSON.stringify(nextPayload));
      const saved = sessionId
        ? await supabase.from("dress_me_sessions").update(nextPayload).eq("id", sessionId).select("id").single()
        : await supabase.from("dress_me_sessions").insert(nextPayload).select("id").single();
      if (!saved.error && saved.data?.id) setSessionId(saved.data.id as string);

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
        <p>Select a body reference and clothes for <strong>{activeProfile?.display_name || "the active profile"}</strong>. This restores today’s choices per profile and resets automatically on the next NZ day.</p>
        <p className="muted-small">NZ time: {nzClockLabel}{saving ? " · saving…" : " · saved for today"}</p>
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
            <input value={occasion} onChange={(event) => setOccasion(event.target.value)} placeholder="Optional: city meeting, yacht club breakfast, WFH, dinner..." />
          </label>

          <label>
            Weather / vibe
            <input value={weather} onChange={(event) => setWeather(event.target.value)} placeholder="Optional: cold, raining, warm, on camera, smart casual..." />
          </label>

          <label>
            Generation notes
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional: any specific instruction for the try-on. Nothing is prefilled anymore." />
          </label>

          <div className="button-row">
            <button type="button" className="secondary-button" onClick={startVoiceNotes}>{speechActive ? "Listening…" : "Speak notes"}</button>
          </div>

          <div>
            <p>Clothes</p>
            {clothing.length === 0 ? (
              <p className="notice">Upload some clothes first for {activeProfile?.display_name || "this profile"}.</p>
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
                      {item.name}{(item.angle_count ?? 1) > 1 ? ` · ${item.angle_count} angles` : ""}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <button disabled={loading || !activeProfileId} onClick={generate}>{loading ? "Generating..." : "Generate preview"}</button>
          {profileError && <p className="error">Profile error: {profileError}</p>}
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
