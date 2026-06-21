"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useProfiles } from "@/lib/useProfiles";
import type { OutfitPreview, StylistSession, WardrobeItem } from "@/lib/types";
import { addDaysToIsoDate, formatNzCalendarDate, nzNowLabel, nzTodayIso, NZ_TIME_ZONE, weekdayFromIsoDate } from "@/lib/nzTime";

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

const WEATHER_PREF_KEY = "wardrobeAI:useLiveWeather";
const CALENDAR_PREF_KEY = "wardrobeAI:useCalendarContext";
const AUTOGEN_PREF_KEY = "wardrobeAI:autoMorningLooks";
const LEGACY_FORCED_VIBES = [
  "polished, modern, comfortable, camera-friendly.",
  "polished, modern, comfortable",
  "client-ready",
];

function cleanSavedVibe(value?: string | null) {
  const text = (value || "").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  if (LEGACY_FORCED_VIBES.some((forced) => lower.includes(forced))) return "";
  return text;
}

function selectedKey(profileId: string, dateIso: string) {
  return `wardrobeAI:dressMeSelection:${profileId || "demo"}:${dateIso}`;
}

function weatherCodeLabel(code: number) {
  if ([0, 1].includes(code)) return "clear";
  if ([2, 3].includes(code)) return "cloudy";
  if ([45, 48].includes(code)) return "foggy";
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([95, 96, 99].includes(code)) return "storm";
  return "mixed";
}

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || `HTTP ${response.status}` };
  }
}

async function fetchWeatherSummary(selectedDate: string) {
  const fallback = { latitude: -36.8485, longitude: 174.7633, place: "Auckland" };
  const position = await new Promise<typeof fallback>((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(fallback);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, place: "current location" }),
      () => resolve(fallback),
      { enableHighAccuracy: false, timeout: 3500, maximumAge: 1000 * 60 * 30 },
    );
  });

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(position.latitude));
  url.searchParams.set("longitude", String(position.longitude));
  url.searchParams.set("current", "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m");
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code");
  url.searchParams.set("timezone", NZ_TIME_ZONE);
  url.searchParams.set("start_date", selectedDate);
  url.searchParams.set("end_date", selectedDate);

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error("Weather unavailable");
  const data = await response.json();
  const now = data.current ?? {};
  const daily = data.daily ?? {};
  const code = Number(now.weather_code ?? daily.weather_code?.[0] ?? 3);
  const high = Math.round(Number(daily.temperature_2m_max?.[0] ?? now.temperature_2m ?? 0));
  const low = Math.round(Number(daily.temperature_2m_min?.[0] ?? now.apparent_temperature ?? 0));
  const temp = Math.round(Number(now.temperature_2m ?? high));
  const feels = Math.round(Number(now.apparent_temperature ?? temp));
  const rain = Math.round(Number(daily.precipitation_probability_max?.[0] ?? 0));
  const wind = Math.round(Number(now.wind_speed_10m ?? 0));

  return `${position.place}: ${temp}°C now, feels ${feels}°C · high ${high}° / low ${low}° · ${weatherCodeLabel(code)} · rain ${rain}% · wind ${wind} km/h`;
}

export default function PlannerPage() {
  const { activeProfile, activeProfileId, loadingProfiles, profileError } = useProfiles();
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [bodyId, setBodyId] = useState("");
  const [selectedDate, setSelectedDate] = useState(nzTodayIso());
  const [nzClock, setNzClock] = useState(nzNowLabel());
  const [dayContext, setDayContext] = useState("");
  const [weather, setWeather] = useState("");
  const [calendarContext, setCalendarContext] = useState("");
  const [vibe, setVibe] = useState("");
  const [useLiveWeather, setUseLiveWeather] = useState(true);
  const [useCalendar, setUseCalendar] = useState(true);
  const [autoMorning, setAutoMorning] = useState(true);
  const [result, setResult] = useState<Recommendation | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [error, setError] = useState("");
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [previewLoading, setPreviewLoading] = useState("");
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [swapSelections, setSwapSelections] = useState<Record<string, string[]>>({});
  const [swapModes, setSwapModes] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);
  const lastHydration = useRef("");

  const hydrationKey = `${activeProfileId}:${selectedDate}`;

  const loadWeather = useCallback(async () => {
    setWeatherLoading(true);
    try {
      setWeather(await fetchWeatherSummary(selectedDate));
    } catch {
      setWeather("Auckland/NZ weather unavailable right now — choose practical layers and weather-safe shoes if rain is likely.");
    } finally {
      setWeatherLoading(false);
    }
  }, [selectedDate]);

  const loadCalendarContext = useCallback(async () => {
    if (!activeProfileId) return;
    setCalendarLoading(true);
    try {
      const url = new URL("/api/calendar/context", window.location.origin);
      url.searchParams.set("profileId", activeProfileId);
      url.searchParams.set("date", selectedDate);
      const response = await fetch(url.toString());
      const payload = await readJson(response);
      setCalendarContext(payload.context || "No connected calendar yet.");
    } catch {
      setCalendarContext("Calendar not connected yet. Add meetings or plans in the brief if needed.");
    } finally {
      setCalendarLoading(false);
    }
  }, [activeProfileId, selectedDate]);

  useEffect(() => {
    const handle = window.setInterval(() => setNzClock(nzNowLabel()), 60_000);
    setNzClock(nzNowLabel());
    return () => window.clearInterval(handle);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedWeather = localStorage.getItem(WEATHER_PREF_KEY);
    const savedCalendar = localStorage.getItem(CALENDAR_PREF_KEY);
    const savedAuto = localStorage.getItem(AUTOGEN_PREF_KEY);
    const weatherEnabled = savedWeather !== "false";
    const calendarEnabled = savedCalendar !== "false";
    setUseLiveWeather(weatherEnabled);
    setUseCalendar(calendarEnabled);
    setAutoMorning(savedAuto !== "false");
  }, []);

  useEffect(() => {
    if (useLiveWeather) void loadWeather();
  }, [useLiveWeather, loadWeather]);

  useEffect(() => {
    if (useCalendar) void loadCalendarContext();
  }, [useCalendar, loadCalendarContext]);

  useEffect(() => {
    if (!activeProfileId || loadingProfiles) return;
    async function load() {
      setError("");
      let query = supabase
        .from("wardrobe_items")
        .select("*")
        .eq("profile_id", activeProfileId)
        .eq("is_archived", false)
        .order("created_at", { ascending: false });
      const { data, error } = await query;
      if (error) {
        setError(error.message);
        return;
      }
      const loaded = (data ?? []) as WardrobeItem[];
      setItems(loaded);
      const firstBody = loaded.find((item) => item.category === "body_reference");
      setBodyId((current) => current || firstBody?.id || "");
    }
    void load();
  }, [activeProfileId, loadingProfiles]);

  useEffect(() => {
    if (!activeProfileId || loadingProfiles) return;
    async function hydrate() {
      setHydrated(false);
      lastHydration.current = hydrationKey;
      setError("");
      setResult(null);
      setPreviews({});
      setSessionId("");

      const localRaw = localStorage.getItem(`wardrobeAI:stylist:${hydrationKey}`);
      let local: Partial<StylistSession> & { last_recommendation?: Recommendation } = {};
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

      if (lastHydration.current !== hydrationKey) return;
      const session = (data as StylistSession | null) || local;
      if (session?.id) setSessionId(session.id);
      setDayContext(session?.day_context || local.day_context || "");
      if (session?.weather_summary || local.weather_summary) setWeather(session?.weather_summary || local.weather_summary || "");
      setVibe(cleanSavedVibe(session?.desired_vibe || local.desired_vibe || ""));
      if (session?.active_body_item_id || local.active_body_item_id) setBodyId(session.active_body_item_id || local.active_body_item_id || "");
      const savedRecommendation = (session?.last_recommendation || local.last_recommendation) as Recommendation | undefined;
      if (savedRecommendation?.outfits?.length) setResult({ ...savedRecommendation, outfits: savedRecommendation.outfits.slice(0, 2) });
      setHydrated(true);
    }
    void hydrate();
  }, [activeProfileId, hydrationKey, loadingProfiles, selectedDate]);

  useEffect(() => {
    if (!sessionId) return;
    async function loadPreviews() {
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
      setPreviews(next);
    }
    void loadPreviews();
  }, [sessionId]);

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const bodyRefs = useMemo(() => items.filter((item) => item.category === "body_reference"), [items]);
  const bodyRef = bodyRefs.find((item) => item.id === bodyId) || bodyRefs[0] || null;
  const availableItems = useMemo(
    () => items.filter((item) => item.category !== "body_reference" && !["needs_wash", "drying", "unavailable"].includes(item.laundry_status || "clean")),
    [items],
  );
  const dateChoices = useMemo(() => Array.from({ length: 5 }, (_, index) => addDaysToIsoDate(nzTodayIso(), index)), []);

  function setPreference(key: string, value: boolean) {
    localStorage.setItem(key, String(value));
  }

  function combinedContext() {
    return [
      useCalendar ? calendarContext : "Calendar ignored by preference.",
      dayContext.trim(),
    ].filter(Boolean).join("\n");
  }

  async function persistLocal(recommendation?: Recommendation | null, nextSessionId?: string) {
    if (!activeProfileId) return;
    const payload = {
      owner_id: "demo-user",
      profile_id: activeProfileId,
      selected_date: selectedDate,
      day_context: dayContext || null,
      weather_summary: useLiveWeather ? weather : "Weather ignored by preference.",
      desired_vibe: cleanSavedVibe(vibe) || null,
      active_body_item_id: bodyId || null,
      last_recommendation: recommendation ?? result,
      id: nextSessionId || sessionId,
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem(`wardrobeAI:stylist:${hydrationKey}`, JSON.stringify(payload));
  }

  async function recommend() {
    setError("");
    setCardErrors({});
    setLoading(true);
    try {
      const response = await fetch("/api/recommend-outfits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: activeProfileId,
          sessionId,
          bodyId: bodyRef?.id,
          selectedDate,
          dayContext: combinedContext() || "No calendar details added. Suggest a practical look for today.",
          weather: useLiveWeather ? weather || "Use live NZ weather if available." : "Ignore weather for this recommendation.",
          vibe: cleanSavedVibe(vibe),
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(payload.error || "Recommendation failed");
      const recommendation = payload.recommendation as Recommendation;
      recommendation.outfits = recommendation.outfits.slice(0, 2);
      setResult(recommendation);
      if (payload.sessionId) setSessionId(payload.sessionId);
      await persistLocal(recommendation, payload.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recommendation failed");
    } finally {
      setLoading(false);
    }
  }

  function saveForTryOn(outfit: OutfitPlan, lookLabel: string) {
    const selectedIds = outfit.item_ids.filter((id) => byId.has(id));
    const payload = {
      profileId: activeProfileId,
      selectedDate,
      lookLabel,
      bodyId: bodyRef?.id || bodyId,
      selectedIds,
      occasion: `${formatNzCalendarDate(selectedDate)} · ${dayContext || "today"}`,
      weather: useLiveWeather ? weather : "Weather ignored by preference",
      notes: `${outfit.summary}\n\n${outfit.why_it_works}\nUse only this saved outfit.`,
    };
    localStorage.setItem(selectedKey(activeProfileId, selectedDate), JSON.stringify(payload));
    localStorage.setItem("wardrobeAI:dressMeSelection", JSON.stringify(payload));
  }

  async function generateLook(outfit: OutfitPlan, lookLabel: string) {
    if (!bodyRef) {
      setError("Add a body reference photo first.");
      return;
    }
    const selected = outfit.item_ids.map((id) => byId.get(id)).filter(Boolean) as WardrobeItem[];
    if (selected.length < 1) {
      setError("This look has no usable wardrobe items.");
      return;
    }
    saveForTryOn(outfit, lookLabel);
    setPreviewLoading(lookLabel);
    setCardErrors((current) => ({ ...current, [lookLabel]: "" }));
    setError("");
    try {
      const response = await fetch("/api/generate-outfit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: activeProfileId,
          sessionId,
          lookLabel,
          body: bodyRef,
          selected,
          occasion: `${formatNzCalendarDate(selectedDate)} · ${dayContext || "today"}`,
          weather: useLiveWeather ? weather : "Weather ignored by preference",
          notes: outfit.why_it_works,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(payload.error || "Preview generation failed");
      if (!payload.imageDataUrl) throw new Error("Generation completed but returned no image.");
      setPreviews((current) => ({ ...current, [lookLabel]: payload.imageDataUrl }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Preview generation failed";
      setCardErrors((current) => ({ ...current, [lookLabel]: message }));
    } finally {
      setPreviewLoading("");
    }
  }

  function toggleSwap(lookLabel: string, itemId: string) {
    setSwapSelections((current) => {
      const selected = new Set(current[lookLabel] ?? []);
      if (selected.has(itemId)) selected.delete(itemId);
      else selected.add(itemId);
      return { ...current, [lookLabel]: Array.from(selected) };
    });
  }

  async function swapSelected(outfit: OutfitPlan, lookLabel: string) {
    const swapItemIds = swapSelections[lookLabel] ?? [];
    if (!swapItemIds.length) return outfit;
    setCardErrors((current) => ({ ...current, [lookLabel]: "" }));
    const response = await fetch("/api/swap-outfit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: activeProfileId, outfit, swapItemIds }),
    });
    const payload = await readJson(response);
    if (!response.ok) throw new Error(payload.error || "Swap failed");
    const updated = payload.outfit as OutfitPlan;
    setResult((current) => current ? {
      ...current,
      outfits: current.outfits.map((entry, index) => (String.fromCharCode(65 + index) === lookLabel ? updated : entry)),
    } : current);
    setSwapSelections((current) => ({ ...current, [lookLabel]: [] }));
    setPreviews((current) => {
      const copy = { ...current };
      delete copy[lookLabel];
      return copy;
    });
    return updated;
  }

  async function swapAndGenerate(outfit: OutfitPlan, lookLabel: string) {
    setPreviewLoading(lookLabel);
    try {
      const updated = await swapSelected(outfit, lookLabel);
      await generateLook(updated, lookLabel);
      setSwapModes((current) => ({ ...current, [lookLabel]: false }));
    } catch (err) {
      setCardErrors((current) => ({ ...current, [lookLabel]: err instanceof Error ? err.message : "Swap failed" }));
    } finally {
      setPreviewLoading("");
    }
  }

  const primaryLook = result?.outfits?.[0];

  return (
    <div className="page-shell ux-page">
      <section className="ux-hero card">
        <div>
          <span className="eyebrow">AI stylist</span>
          <h1>Your outfits for today</h1>
          <p className="lead-copy">Two options, picked for your day. Add anything special, change items if needed, then try one on.</p>
        </div>
        <div className="ux-status-card">
          <strong>{activeProfile?.display_name || "Profile"}</strong>
          <span>{nzClock} NZ</span>
          <small>{hydrated && primaryLook ? "Looks ready" : "Ready for today"}</small>
        </div>
      </section>

      <section className="ux-control-strip card">
        <div className="date-pill-row">
          {dateChoices.map((date) => (
            <button key={date} type="button" className={date === selectedDate ? "date-pill active" : "date-pill"} onClick={() => setSelectedDate(date)}>
              <span>{weekdayFromIsoDate(date).slice(0, 3)}</span>
              <strong>{date.slice(-2)}</strong>
            </button>
          ))}
        </div>
        <label className="switch-row">
          <input type="checkbox" checked={useLiveWeather} onChange={(event) => { setUseLiveWeather(event.target.checked); setPreference(WEATHER_PREF_KEY, event.target.checked); }} />
          <span>Weather auto</span>
        </label>
        <label className="switch-row">
          <input type="checkbox" checked={useCalendar} onChange={(event) => { setUseCalendar(event.target.checked); setPreference(CALENDAR_PREF_KEY, event.target.checked); }} />
          <span>Calendar auto</span>
        </label>
        <label className="switch-row">
          <input type="checkbox" checked={autoMorning} onChange={(event) => { setAutoMorning(event.target.checked); setPreference(AUTOGEN_PREF_KEY, event.target.checked); }} />
          <span>5am auto</span>
        </label>
      </section>

      <section className="stylist-command-grid">
        <div className="card command-card visual-first-card">
          <label className="big-brief-label">
            <span>Anything special today?</span>
            <textarea
              value={dayContext}
              onChange={(event) => setDayContext(event.target.value)}
              placeholder="Optional. Example: Sunday afternoon family time, school run, dinner out, client meeting."
              rows={4}
            />
          </label>
          <div className="compact-input-grid">
            <label>
              <span>Body reference</span>
              <select value={bodyRef?.id || bodyId} onChange={(event) => setBodyId(event.target.value)}>
                <option value="">Choose body reference</option>
                {bodyRefs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>
              <span>Style preference (optional)</span>
              <input value={vibe} onChange={(event) => setVibe(event.target.value)} placeholder="Leave blank unless you want a specific style." />
            </label>
          </div>

          <div className="auto-context-grid">
            <div className="context-chip-card"><span>☁️</span><strong>{weatherLoading ? "Weather loading…" : "Weather"}</strong><small>{weather || "Automatic Auckland/NZ fallback"}</small></div>
            <div className="context-chip-card"><span>📅</span><strong>{calendarLoading ? "Calendar loading…" : "Calendar"}</strong><small>{calendarContext || "Hook ready; no connected calendar yet"}</small></div>
          </div>

          <button type="button" className="primary-button wide-action" onClick={recommend} disabled={loading || availableItems.length < 2 || !activeProfileId}>
            {loading ? "Preparing two looks…" : result?.outfits?.length ? "Refresh today’s two looks" : "Create today’s two looks"}
          </button>
          {profileError ? <p className="error">Profile error: {profileError}</p> : null}
          {availableItems.length < 2 ? <p className="notice">Add at least two available clothing items for this profile.</p> : null}
          {error ? <p className="error">{error}</p> : null}
        </div>

        <aside className="card closet-snapshot-card">
          <span className="eyebrow dark">Visual closet</span>
          <div className="closet-metrics-grid">
            <strong>{availableItems.length}</strong><span>ready pieces</span>
            <strong>{bodyRefs.length}</strong><span>body refs</span>
          </div>
          <div className="mini-closet-grid">
            {availableItems.slice(0, 6).map((item) => <img src={item.image_url} alt={item.name} key={item.id} />)}
          </div>
          <a className="ghost-link" href="/wardrobe">Manage closet</a>
        </aside>
      </section>

      {result ? (
        <section className="looks-board">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow dark">Two outfits only</span>
              <h2>Your two options</h2>
              <p>{result.day_brief}</p>
            </div>
          </div>

          <div className="look-card-grid two-look-grid">
            {result.outfits.slice(0, 2).map((outfit, index) => {
              const lookLabel = String.fromCharCode(65 + index);
              const outfitItems = outfit.item_ids.map((id) => byId.get(id)).filter(Boolean) as WardrobeItem[];
              const selectedForSwap = new Set(swapSelections[lookLabel] ?? []);
              const hasSwaps = selectedForSwap.size > 0;
              const isSwapMode = Boolean(swapModes[lookLabel]);
              return (
                <article className="card look-card-visual" key={`${outfit.label}-${index}`}>
                  <div className="look-card-media">
                    {previews[lookLabel] ? (
                      <img className="generated-look-image" src={previews[lookLabel]} alt={`Generated Look ${lookLabel}`} />
                    ) : (
                      <div className="outfit-collage">
                        {outfitItems.slice(0, 5).map((item) => <img key={item.id} src={item.image_url} alt={item.name} />)}
                      </div>
                    )}
                    <span className="look-badge">Look {lookLabel}</span>
                  </div>
                  <div className="look-card-copy">
                    <h3>{outfit.summary}</h3>
                    <div className="look-meta-row">
                      <span className="small-chip">formality {outfit.formality_score}/10</span>
                      <span className="small-chip">warmth {outfit.warmth_score}/10</span>
                    </div>
                    <p>{outfit.why_it_works}</p>
                    {isSwapMode ? <p className="swap-helper">Select every item you want changed. Nothing regenerates until you confirm.</p> : null}
                    <div className={isSwapMode ? "swap-thumb-grid swap-active" : "swap-thumb-grid"}>
                      {outfitItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={["swap-thumb", selectedForSwap.has(item.id) ? "selected" : "", !isSwapMode ? "read-only" : ""].filter(Boolean).join(" ")}
                          onClick={() => { if (isSwapMode) toggleSwap(lookLabel, item.id); }}
                          aria-pressed={selectedForSwap.has(item.id)}
                        >
                          <img src={item.image_url} alt={item.name} />
                          <span>{selectedForSwap.has(item.id) ? "Will swap" : item.category}</span>
                        </button>
                      ))}
                    </div>
                    {cardErrors[lookLabel] ? <p className="error compact-error">{cardErrors[lookLabel]}</p> : null}
                    <div className="button-row wrap-buttons">
                      {isSwapMode ? (
                        <>
                          <button type="button" className="primary-button" onClick={() => swapAndGenerate(outfit, lookLabel)} disabled={previewLoading === lookLabel || !hasSwaps}>
                            {previewLoading === lookLabel ? "Regenerating…" : hasSwaps ? "Regenerate selected items" : "Select items first"}
                          </button>
                          <button type="button" className="secondary-button" onClick={() => {
                            setSwapSelections((current) => ({ ...current, [lookLabel]: [] }));
                            setSwapModes((current) => ({ ...current, [lookLabel]: false }));
                          }}>Cancel swap</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="primary-button" onClick={() => generateLook(outfit, lookLabel)} disabled={previewLoading === lookLabel || !bodyRef}>
                            {previewLoading === lookLabel ? "Generating…" : previews[lookLabel] ? "Regenerate preview" : `Generate Look ${lookLabel}`}
                          </button>
                          <button type="button" className="secondary-button" onClick={() => setSwapModes((current) => ({ ...current, [lookLabel]: true }))}>Change items</button>
                        </>
                      )}
                      <a className="secondary-button" href="/generate" onClick={() => saveForTryOn(outfit, lookLabel)}>Open try-on</a>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="card empty-state-card soft-empty visual-empty">
          <span className="eyebrow dark">Morning concierge</span>
          <h2>Two looks, no wardrobe dump.</h2>
          <p>Create today’s two looks once. To change a look, select all items you want swapped first, then regenerate once.</p>
        </section>
      )}
    </div>
  );
}
