"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useProfiles } from "@/lib/useProfiles";
import type { OutfitPreview, StylistSession, WardrobeItem } from "@/lib/types";
import { addDaysToIsoDate, formatNzCalendarDate, nzNowLabel, nzTimeOnlyLabel, nzTodayIso, NZ_TIME_ZONE, weekdayFromIsoDate } from "@/lib/nzTime";

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

function todayIso() {
  return nzTodayIso();
}

function dayFromDate(date: string) {
  return weekdayFromIsoDate(date);
}

function weatherCodeLabel(code: number) {
  if ([0].includes(code)) return "clear";
  if ([1, 2, 3].includes(code)) return "partly cloudy";
  if ([45, 48].includes(code)) return "fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "rain/showers";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([95, 96, 99].includes(code)) return "thunderstorms";
  return "mixed weather";
}

function getSpeechRecognition() {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => any;
    webkitSpeechRecognition?: new () => any;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export default function PlannerPage() {
  const { activeProfile, activeProfileId, loadingProfiles, profileError } = useProfiles();
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [bodyId, setBodyId] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const selectedDay = dayFromDate(selectedDate);
  const [nzClockLabel, setNzClockLabel] = useState(nzNowLabel());
  const todayRef = useRef(todayIso());
  const [dayContext, setDayContext] = useState("");
  const [weather, setWeather] = useState("");
  const [vibe, setVibe] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [result, setResult] = useState<Recommendation | null>(null);
  const [previewImages, setPreviewImages] = useState<Record<string, string>>({});
  const [generatingLooks, setGeneratingLooks] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState("");
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [locationStatus, setLocationStatus] = useState("");
  const [speechActive, setSpeechActive] = useState(false);
  const hydrationKey = `${activeProfileId}:${selectedDate}`;
  const activeHydrationKeyRef = useRef("");

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

  const loadItems = useCallback(async () => {
    if (!activeProfileId) {
      setItems([]);
      return;
    }

    const { data, error } = await supabase
      .from("wardrobe_items")
      .select("*")
      .eq("profile_id", activeProfileId)
      .eq("is_archived", false)
      .order("created_at", { ascending: false });

    if (!error) {
      const loaded = (data ?? []) as WardrobeItem[];
      setItems(loaded);
      const firstBody = loaded.find((item) => item.category === "body_reference");
      setBodyId((current) => {
        if (current && loaded.some((item) => item.id === current)) return current;
        return firstBody?.id || "";
      });
    } else setError(error.message);
  }, [activeProfileId]);

  useEffect(() => {
    if (!loadingProfiles) void loadItems();
  }, [loadingProfiles, loadItems]);

  useEffect(() => {
    const handle = window.setInterval(() => {
      const today = todayIso();
      setNzClockLabel(nzNowLabel());
      if (today !== todayRef.current) {
        setSelectedDate((current) => current === todayRef.current ? today : current);
        todayRef.current = today;
      }
    }, 60_000);

    setNzClockLabel(nzNowLabel());
    return () => window.clearInterval(handle);
  }, []);

  useEffect(() => {
    async function hydrateSession() {
      if (!activeProfileId || loadingProfiles) return;
      setHydrated(false);
      activeHydrationKeyRef.current = hydrationKey;
      setError("");
      setSessionId("");
      setResult(null);
      setPreviewImages({});

      let local: Partial<StylistSession> & { last_recommendation?: Recommendation } = {};
      const localRaw = localStorage.getItem(`wardrobeAI:stylist:${hydrationKey}`);
      if (localRaw) {
        try { local = JSON.parse(localRaw); } catch { local = {}; }
      }

      const { data } = await supabase
        .from("stylist_sessions")
        .select("*")
        .eq("profile_id", activeProfileId)
        .eq("selected_date", selectedDate)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeHydrationKeyRef.current !== hydrationKey) return;

      const session = (data as StylistSession | null) || local;
      if (session?.id) setSessionId(session.id);
      setDayContext(session?.day_context || local.day_context || "");
      setWeather(session?.weather_summary || local.weather_summary || "");
      setVibe(session?.desired_vibe || local.desired_vibe || "");
      if (session?.active_body_item_id || local.active_body_item_id) setBodyId(session.active_body_item_id || local.active_body_item_id || "");
      const savedRecommendation = (session?.last_recommendation || local.last_recommendation) as Recommendation | undefined;
      if (savedRecommendation?.outfits?.length) setResult(savedRecommendation);
      setHydrated(true);
    }

    void hydrateSession();
  }, [activeProfileId, selectedDate, hydrationKey, loadingProfiles]);

  const persistSession = useCallback(async (recommendation?: Recommendation | null) => {
    if (!activeProfileId) return sessionId;
    const payload = {
      owner_id: "demo-user",
      profile_id: activeProfileId,
      selected_date: selectedDate,
      day_context: dayContext || null,
      weather_summary: weather || null,
      desired_vibe: vibe || null,
      active_body_item_id: bodyId || null,
      draft_prompt: dayContext || null,
      last_recommendation: recommendation ?? result ?? null,
      updated_at: new Date().toISOString()
    };

    localStorage.setItem(`wardrobeAI:stylist:${hydrationKey}`, JSON.stringify(payload));

    setSaving(true);
    const saved = sessionId
      ? await supabase.from("stylist_sessions").update(payload).eq("id", sessionId).select("id").single()
      : await supabase.from("stylist_sessions").insert(payload).select("id").single();
    setSaving(false);

    if (!saved.error && saved.data?.id) {
      setSessionId(saved.data.id);
      return saved.data.id as string;
    }

    return sessionId;
  }, [activeProfileId, bodyId, dayContext, hydrationKey, result, selectedDate, sessionId, vibe, weather]);

  useEffect(() => {
    if (!hydrated || !activeProfileId) return;
    const handle = window.setTimeout(() => {
      void persistSession();
    }, 900);
    return () => window.clearTimeout(handle);
  }, [activeProfileId, bodyId, dayContext, hydrated, persistSession, selectedDate, vibe, weather]);

  useEffect(() => {
    async function loadPreviews() {
      if (!sessionId) return;
      const { data } = await supabase
        .from("outfit_previews")
        .select("*")
        .eq("stylist_session_id", sessionId)
        .eq("status", "complete")
        .order("created_at", { ascending: false });

      const next: Record<string, string> = {};
      for (const preview of (data ?? []) as OutfitPreview[]) {
        if (!next[preview.look_label] && preview.output_base64) next[preview.look_label] = `data:image/png;base64,${preview.output_base64}`;
        if (!next[preview.look_label] && preview.output_image_url) next[preview.look_label] = preview.output_image_url;
      }
      setPreviewImages(next);
    }
    void loadPreviews();
  }, [sessionId]);

  async function recommend() {
    setError("");
    setResult(null);
    setPreviewImages({});
    setLoading(true);
    try {
      const response = await fetch("/api/recommend-outfits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: activeProfileId, sessionId, bodyId, selectedDate, dayContext, weather, vibe })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Recommendation failed");
      const recommendation = payload.recommendation as Recommendation;
      setResult(recommendation);
      if (payload.sessionId) setSessionId(payload.sessionId);
      await persistSession(recommendation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recommendation failed");
    } finally {
      setLoading(false);
    }
  }

  async function generateLook(outfit: OutfitPlan, lookLabel: string) {
    setError("");
    if (!bodyRef) {
      setError("Upload/select a body reference before generating a look on you.");
      return;
    }
    const selected = outfit.item_ids.map((id) => byId.get(id)).filter(Boolean) as WardrobeItem[];
    if (!selected.length) {
      setError("This look has no valid wardrobe items.");
      return;
    }

    setGeneratingLooks((current) => ({ ...current, [lookLabel]: true }));
    try {
      const savedSessionId = sessionId || await persistSession(result);
      const response = await fetch("/api/generate-outfit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: activeProfileId,
          sessionId: savedSessionId,
          lookLabel,
          body: bodyRef,
          selected,
          occasion: `${selectedDay} ${selectedDate}: ${dayContext}`,
          weather,
          notes: `${outfit.summary}\n\n${outfit.why_it_works}\nUse only this look's selected wardrobe items. Preserve identity and body proportions.`
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Generation failed");
      setPreviewImages((current) => ({ ...current, [lookLabel]: payload.imageDataUrl }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGeneratingLooks((current) => ({ ...current, [lookLabel]: false }));
    }
  }

  function useInDressMe(outfit: OutfitPlan) {
    localStorage.setItem(
      "wardrobeAI:dressMeSelection",
      JSON.stringify({
        profileId: activeProfileId,
        selectedDate,
        bodyId,
        selectedIds: outfit.item_ids,
        occasion: `${selectedDay} ${selectedDate}: ${dayContext}`,
        weather,
        notes: `${outfit.summary}\n\n${outfit.why_it_works}\nUse the real body reference and selected accessories. Preserve identity.`
      })
    );
    window.location.href = "/generate";
  }

  async function fetchWeatherForPosition(position: GeolocationPosition) {
    setLocationStatus("Fetching live forecast…");
    const lat = position.coords.latitude.toFixed(4);
    const lon = position.coords.longitude.toFixed(4);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&timezone=${encodeURIComponent(NZ_TIME_ZONE)}&start_date=${selectedDate}&end_date=${selectedDate}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Weather service did not return a forecast.");
    const payload = await response.json();
    const daily = payload.daily;
    const current = payload.current;
    const code = Number(daily.weather_code?.[0] ?? current?.weather_code ?? 0);
    const max = Math.round(Number(daily.temperature_2m_max?.[0] ?? 0));
    const min = Math.round(Number(daily.temperature_2m_min?.[0] ?? 0));
    const rain = Math.round(Number(daily.precipitation_probability_max?.[0] ?? 0));
    const wind = Math.round(Number(daily.wind_speed_10m_max?.[0] ?? current?.wind_speed_10m ?? 0));
    const currentTemp = current?.temperature_2m == null ? "" : ` Current: ${Math.round(Number(current.temperature_2m))}°C.`;
    const timeLabel = nzTimeOnlyLabel();
    const dateLabel = formatNzCalendarDate(selectedDate);
    setWeather(`NZ time now ${timeLabel}. Forecast for ${dateLabel}: ${max}°C / ${min}°C, ${weatherCodeLabel(code)}, ${rain}% rain chance, wind up to ${wind} km/h.${currentTemp} Based on my current location.`);
    setLocationStatus("Weather loaded in NZ time.");
  }

  async function fetchLiveWeather() {
    setError("");
    setWeatherLoading(true);
    setLocationStatus("Requesting location…");

    try {
      if (!navigator.geolocation) throw new Error("Browser geolocation is not available.");
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 12000, maximumAge: 30 * 60 * 1000 });
      });

      localStorage.setItem("wardrobeAI:lastLocation", JSON.stringify({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        saved_at: new Date().toISOString()
      }));
      await fetchWeatherForPosition(position);
    } catch (err) {
      setLocationStatus("");
      setError(err instanceof Error ? err.message : "Could not fetch live weather.");
    } finally {
      setWeatherLoading(false);
    }
  }

  function startVoiceInput() {
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
      if (transcript) setDayContext((current) => [current, transcript].filter(Boolean).join(current ? "\n" : ""));
    };
    recognition.onerror = () => setError("Voice input stopped before capturing text.");
    recognition.onend = () => setSpeechActive(false);
    recognition.start();
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
              <p className="planner-subtitle">Looks for {activeProfile?.display_name || "the active profile"}, generated separately on the selected body reference.</p>
            </div>
          </div>

          <div className="chip-group">
            <span className="small-chip">NZ time: {nzClockLabel}</span>
            {weekdayOptions.map((day) => (
              <button
                type="button"
                key={day}
                className={`seg-chip ${selectedDay === day ? "is-active" : ""}`}
                onClick={() => {
                  const today = todayIso();
                  const todayIndex = weekdayOptions.indexOf(dayFromDate(today));
                  const targetIndex = weekdayOptions.indexOf(day);
                  const diff = targetIndex - todayIndex;
                  setSelectedDate(addDaysToIsoDate(today, diff));
                }}
              >
                {day}
              </button>
            ))}
          </div>
        </div>

        <div className="planner-two-col">
          <div className="planner-form card inset-card">
            <span className="eyebrow dark">Stylist</span>
            <h2 className="section-h2">Brief the stylist.</h2>
            <div className="form">
              <label>
                Date
                <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value || todayIso())} />
              </label>
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
                <textarea
                  value={dayContext}
                  onChange={(event) => setDayContext(event.target.value)}
                  placeholder="Tell the stylist what is happening today. Example: yacht club breakfast, rain, cold, smart but not too corporate."
                />
              </label>
              <div className="button-row">
                <button type="button" className="secondary-button" onClick={startVoiceInput}>{speechActive ? "Listening…" : "Speak brief"}</button>
              </div>
              <label>
                Weather / outside time
                <input
                  value={weather}
                  onChange={(event) => setWeather(event.target.value)}
                  placeholder="Fetch live weather or type it manually. Example: cold, showers, 20 minutes outside."
                />
              </label>
              <div className="button-row">
                <button type="button" className="secondary-button" onClick={fetchLiveWeather} disabled={weatherLoading}>{weatherLoading ? "Fetching weather…" : "Use live NZ-time weather for this date"}</button>
                {locationStatus ? <span className="muted-small">{locationStatus}</span> : null}
              </div>
              <label>
                Desired vibe
                <input
                  value={vibe}
                  onChange={(event) => setVibe(event.target.value)}
                  placeholder="Optional: polished, relaxed-smart, client-ready, school-run practical, date night, etc."
                />
              </label>
              <div className="button-row">
                <button type="button" onClick={recommend} disabled={loading || !activeProfileId}>{loading ? "Stylist is thinking..." : "Recommend looks"}</button>
                <button type="button" className="secondary-button" onClick={() => persistSession()} disabled={saving || !activeProfileId}>{saving ? "Saving…" : "Save session"}</button>
                <a className="ghost-link" href="/wardrobe">Wardrobe</a>
              </div>
              {profileError ? <p className="error">Profile error: {profileError}</p> : null}
              {error ? <p className="error">{error}</p> : null}
              {saving ? <p className="muted-small">Saving session…</p> : null}
            </div>
          </div>

          <aside className="day-brief card inset-card">
            <span className="eyebrow dark">Today</span>
            <h2 className="day-date">{selectedDay}</h2>
            <p className="weather-line">{weather || "Add weather manually or tap live NZ-time weather."}</p>
            <div className="weather-chip-row">
              <span className="small-chip">profile aware</span>
              <span className="small-chip">camera aware</span>
              <span className="small-chip">weather aware</span>
            </div>
            <div className="divider" />
            <div className="schedule-list">
              <span className="section-label">Schedule</span>
              {scheduleRows.length ? scheduleRows.map((row) => <p key={row}>{row}</p>) : <p>Add your schedule in the day context field or speak it in.</p>}
            </div>
            <div className="divider" />
            <div className="schedule-list">
              <span className="section-label">Read</span>
              <p>
                Dressing to {activeProfile?.display_name || "the active profile"}: {activeProfile?.style_profile || "run the profile migration first."}
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
            const generatedImage = previewImages[lookLabel];
            const isGenerating = Boolean(generatingLooks[lookLabel]);

            return (
              <article className="look-layout card" key={`${outfit.label}-${index}`}>
                <div className="look-preview-frame">
                  <span className="section-label">On you · Look {lookLabel}</span>
                  {generatedImage ? (
                    <img className="body-preview-image" src={generatedImage} alt={`Generated outfit preview for Look ${lookLabel}`} />
                  ) : (
                    <div className="tryon-placeholder">
                      <strong>{isGenerating ? `Generating Look ${lookLabel} on you…` : `Look ${lookLabel} not generated yet`}</strong>
                      <span>This no longer shows the raw body reference as a fake preview. Generate each look separately.</span>
                    </div>
                  )}
                  <button type="button" onClick={() => generateLook(outfit, lookLabel)} disabled={!bodyRef || isGenerating}>
                    {isGenerating ? `Generating Look ${lookLabel}...` : `Generate Look ${lookLabel} on me`}
                  </button>
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
                          <span>{(item.category || "item").replaceAll("_", " ")}{(item.angle_count ?? 1) > 1 ? ` · ${item.angle_count} angles` : ""}</span>
                        </div>
                      </article>
                    ))}
                  </div>

                  <blockquote className="style-read">{outfit.why_it_works}</blockquote>
                  {outfit.watch_outs?.length ? <p className="muted-small">Watch outs: {outfit.watch_outs.join(" · ")}</p> : null}

                  <div className="button-row">
                    <button type="button" className="secondary-button" onClick={() => useInDressMe(outfit)} disabled={!bodyId}>Open this look in Dress Me</button>
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
            Tap <strong>Recommend looks</strong>. Each recommendation will show a placeholder first, then you generate Look A/B/C on your selected body reference one by one.
          </p>
        </section>
      )}
    </div>
  );
}
