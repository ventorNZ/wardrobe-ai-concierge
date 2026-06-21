import { randomUUID } from "crypto";
import type { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type CalendarProvider = "google" | "outlook";

export type CalendarConnection = {
  id: string;
  owner_id: string;
  profile_id: string;
  provider: CalendarProvider;
  access_token: string;
  refresh_token?: string | null;
  expires_at?: string | null;
  email?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type CalendarEventLite = {
  title: string;
  start?: string;
  end?: string;
  location?: string;
  online?: boolean;
  provider?: CalendarProvider;
  dressSignal?: "online_internal" | "online_client" | "in_person" | "formal" | "casual" | "unknown";
};

export const CALENDAR_OWNER_COOKIE = "wardrobe_calendar_owner";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function safeOwnerId(value?: string | null) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{12,80}$/.test(value) ? value : "";
}

export function getOrCreateCalendarOwnerId(request: NextRequest) {
  return safeOwnerId(request.cookies.get(CALENDAR_OWNER_COOKIE)?.value) || randomUUID();
}

export function setCalendarOwnerCookie(response: NextResponse, ownerId: string) {
  response.cookies.set(CALENDAR_OWNER_COOKIE, ownerId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return response;
}

function baseUrlFromRequest(url: string) {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

export function calendarRedirectUri(requestUrl: string, provider: CalendarProvider) {
  return `${baseUrlFromRequest(requestUrl)}/api/calendar/callback/${provider}`;
}

function encodeCalendarState(state: { provider: CalendarProvider; profileId: string; ownerId: string; returnTo?: string }) {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

export function googleAuthUrl(requestUrl: string, profileId: string, ownerId: string, returnTo = "/planner") {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  if (!clientId) throw new Error("Missing GOOGLE_CALENDAR_CLIENT_ID");
  const state = encodeCalendarState({ provider: "google", profileId, ownerId, returnTo });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", calendarRedirectUri(requestUrl, "google"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email https://www.googleapis.com/auth/calendar.readonly");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export function outlookAuthUrl(requestUrl: string, profileId: string, ownerId: string, returnTo = "/planner") {
  const clientId = process.env.OUTLOOK_CALENDAR_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) throw new Error("Missing OUTLOOK_CALENDAR_CLIENT_ID or MICROSOFT_CLIENT_ID");
  const state = encodeCalendarState({ provider: "outlook", profileId, ownerId, returnTo });
  const tenant = process.env.MICROSOFT_TENANT_ID || "common";
  const url = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", calendarRedirectUri(requestUrl, "outlook"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "offline_access User.Read Calendars.Read");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("state", state);
  return url.toString();
}

export function parseCalendarState(state: string | null) {
  if (!state) throw new Error("Missing OAuth state");
  const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as {
    provider: CalendarProvider;
    profileId: string;
    ownerId?: string;
    returnTo?: string;
  };
  if (!parsed.profileId || !["google", "outlook"].includes(parsed.provider)) throw new Error("Invalid OAuth state");
  const ownerId = safeOwnerId(parsed.ownerId) || randomUUID();
  return { ...parsed, ownerId, returnTo: parsed.returnTo || "/planner" };
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { error: text }; }
  if (!response.ok) throw new Error(json.error_description || json.error?.message || json.error || `Calendar API failed: ${response.status}`);
  return json;
}

function expiresAtFromNow(expiresIn?: number) {
  return expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
}

export async function exchangeGoogleCode(requestUrl: string, code: string) {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing Google calendar OAuth environment variables");
  return fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: calendarRedirectUri(requestUrl, "google"),
      grant_type: "authorization_code",
    }),
  }) as Promise<{ access_token: string; refresh_token?: string; expires_in?: number; id_token?: string }>;
}

export async function exchangeOutlookCode(requestUrl: string, code: string) {
  const clientId = process.env.OUTLOOK_CALENDAR_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CALENDAR_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET;
  const tenant = process.env.MICROSOFT_TENANT_ID || "common";
  if (!clientId || !clientSecret) throw new Error("Missing Microsoft calendar OAuth environment variables");
  return fetchJson(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: calendarRedirectUri(requestUrl, "outlook"),
      grant_type: "authorization_code",
    }),
  }) as Promise<{ access_token: string; refresh_token?: string; expires_in?: number }>;
}

async function fetchGoogleEmail(accessToken: string) {
  try {
    const json = await fetchJson("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return json.email || null;
  } catch {
    return null;
  }
}

async function fetchOutlookEmail(accessToken: string) {
  try {
    const json = await fetchJson("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return json.mail || json.userPrincipalName || null;
  } catch {
    return null;
  }
}

export async function saveCalendarConnection(ownerId: string, profileId: string, provider: CalendarProvider, token: { access_token: string; refresh_token?: string; expires_in?: number }) {
  const supabaseAdmin = getSupabaseAdmin();
  const email = provider === "google" ? await fetchGoogleEmail(token.access_token) : await fetchOutlookEmail(token.access_token);
  const payload = {
    owner_id: ownerId,
    profile_id: profileId,
    provider,
    access_token: token.access_token,
    refresh_token: token.refresh_token || null,
    expires_at: expiresAtFromNow(token.expires_in),
    email,
    updated_at: new Date().toISOString(),
  };
  const saved = await supabaseAdmin
    .from("calendar_connections")
    .upsert(payload, { onConflict: "owner_id,profile_id,provider" })
    .select("id")
    .single();
  if (saved.error) throw saved.error;
  return saved.data;
}

export async function listCalendarConnections(profileId: string, ownerId: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("calendar_connections")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("profile_id", profileId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CalendarConnection[];
}

export async function disconnectCalendarConnection(profileId: string, ownerId: string, provider?: CalendarProvider) {
  const supabaseAdmin = getSupabaseAdmin();
  let query = supabaseAdmin
    .from("calendar_connections")
    .delete()
    .eq("owner_id", ownerId)
    .eq("profile_id", profileId);
  if (provider) query = query.eq("provider", provider);
  const { error } = await query;
  if (error) throw error;
  return true;
}

async function refreshGoogleToken(connection: CalendarConnection) {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret || !connection.refresh_token) throw new Error("Google Calendar token expired. Reconnect Google Calendar.");
  const token = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: connection.refresh_token,
      grant_type: "refresh_token",
    }),
  }) as { access_token: string; refresh_token?: string; expires_in?: number };
  return updateConnectionToken(connection, token);
}

async function refreshOutlookToken(connection: CalendarConnection) {
  const clientId = process.env.OUTLOOK_CALENDAR_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CALENDAR_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET;
  const tenant = process.env.MICROSOFT_TENANT_ID || "common";
  if (!clientId || !clientSecret || !connection.refresh_token) throw new Error("Outlook Calendar token expired. Reconnect Outlook Calendar.");
  const token = await fetchJson(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: connection.refresh_token,
      grant_type: "refresh_token",
      scope: "offline_access User.Read Calendars.Read",
    }),
  }) as { access_token: string; refresh_token?: string; expires_in?: number };
  return updateConnectionToken(connection, token);
}

async function updateConnectionToken(connection: CalendarConnection, token: { access_token: string; refresh_token?: string; expires_in?: number }) {
  const supabaseAdmin = getSupabaseAdmin();
  const updated: CalendarConnection = {
    ...connection,
    access_token: token.access_token,
    refresh_token: token.refresh_token || connection.refresh_token,
    expires_at: expiresAtFromNow(token.expires_in),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin
    .from("calendar_connections")
    .update({
      access_token: updated.access_token,
      refresh_token: updated.refresh_token,
      expires_at: updated.expires_at,
      updated_at: updated.updated_at,
    })
    .eq("id", connection.id)
    .eq("owner_id", connection.owner_id);
  if (error) throw error;
  return updated;
}

export async function ensureFreshCalendarConnection(connection: CalendarConnection) {
  const expiresAt = connection.expires_at ? Date.parse(connection.expires_at) : 0;
  const hasExpiredOrSoon = expiresAt && expiresAt < Date.now() + 5 * 60 * 1000;
  if (!hasExpiredOrSoon) return connection;
  return connection.provider === "google" ? refreshGoogleToken(connection) : refreshOutlookToken(connection);
}

const ONLINE_WORDS = /zoom|teams|google meet|meet\.google|webex|online|virtual|video|https?:\/\/|phone call|dial[- ]?in/i;
const CLIENT_WORDS = /client|customer|prospect|vendor|partner|board|exec|executive|presentation|interview|founder|stakeholder|sales|demo/i;
const FORMAL_WORDS = /black tie|wedding|gala|ceremony|funeral|cocktail|formal dress|formal event|dress code|tie required|jacket required|suit required|must wear (a )?suit|full suit required/i;
const CASUAL_WORDS = /family|kids|children|school run|errands|lunch|brunch|coffee|shopping|home|park|bbq|barbecue|walk|personal/i;

export function eventLooksOnline(event: CalendarEventLite) {
  const text = `${event.title || ""} ${event.location || ""}`.toLowerCase();
  return Boolean(event.online || ONLINE_WORDS.test(text));
}

export function classifyCalendarEvent(event: CalendarEventLite): CalendarEventLite["dressSignal"] {
  const text = `${event.title || ""} ${event.location || ""}`.toLowerCase();
  if (FORMAL_WORDS.test(text)) return "formal";
  if (CASUAL_WORDS.test(text)) return "casual";
  if (eventLooksOnline(event)) return CLIENT_WORDS.test(text) ? "online_client" : "online_internal";
  if (text.trim()) return "in_person";
  return "unknown";
}

function humanEventList(events: CalendarEventLite[]) {
  return events.slice(0, 6).map((event) => {
    const when = event.start ? new Date(event.start).toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit", timeZone: "Pacific/Auckland" }) : "";
    return `${when ? `${when} ` : ""}${event.title || "Busy"}`.trim();
  }).join("; ");
}

export function summariseCalendarEvents(events: CalendarEventLite[]) {
  if (!events.length) {
    return "Calendar connected: no events today. Treat today as personal/practical unless the user adds a special brief. Do not default to formal.";
  }

  const enriched = events.map((event) => ({ ...event, dressSignal: classifyCalendarEvent(event) }));
  const titles = humanEventList(enriched);
  const formal = enriched.filter((event) => event.dressSignal === "formal");
  const onlineClient = enriched.filter((event) => event.dressSignal === "online_client");
  const onlineInternal = enriched.filter((event) => event.dressSignal === "online_internal");
  const inPerson = enriched.filter((event) => event.dressSignal === "in_person");
  const casual = enriched.filter((event) => event.dressSignal === "casual");

  if (formal.length) {
    return `Calendar: explicit formal event detected (${titles}). Formal pieces are allowed, but still keep the outfit coherent and avoid novelty clashes.`;
  }
  if (onlineClient.length && !inPerson.length) {
    return `Calendar: online client-facing work only (${titles}). Dress camera-smart on top with smart-casual comfort below. Do not default to a full suit.`;
  }
  if (onlineInternal.length && !onlineClient.length && !inPerson.length) {
    return `Calendar: internal online meetings only (${titles}). Wear a presentable top layer, comfortable bottoms and relaxed shoes. Full suit is wrong unless the user explicitly asks.`;
  }
  if ((onlineClient.length || onlineInternal.length) && inPerson.length) {
    return `Calendar: mixed online and in-person plans (${titles}). Use smart separates and practical shoes; no full suit unless the event has a formal dress code.`;
  }
  if (inPerson.length) {
    return `Calendar: in-person plans (${titles}). Use smart/practical separates for leaving the house; full suit only with explicit formal/client dress-code wording.`;
  }
  if (casual.length) {
    return `Calendar: personal/family plans (${titles}). Keep it relaxed, comfortable and weather-aware, not corporate.`;
  }
  return `Calendar: ${titles}. Use the events as context, but do not over-formalise.`;
}

export async function fetchGoogleEvents(connection: CalendarConnection, date: string) {
  const fresh = await ensureFreshCalendarConnection(connection);
  const timeMin = `${date}T00:00:00+12:00`;
  const timeMax = `${date}T23:59:59+12:00`;
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "16");
  const json = await fetchJson(url.toString(), { headers: { Authorization: `Bearer ${fresh.access_token}` } });
  return ((json.items ?? []) as Array<Record<string, any>>)
    .filter((event) => event.status !== "cancelled")
    .map((event) => {
      const mapped: CalendarEventLite = {
        title: event.summary || "Busy",
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        location: event.location || "",
        online: Boolean(event.hangoutLink || event.conferenceData || event.location?.match?.(ONLINE_WORDS)),
        provider: "google",
      };
      return { ...mapped, dressSignal: classifyCalendarEvent(mapped) };
    });
}

export async function fetchOutlookEvents(connection: CalendarConnection, date: string) {
  const fresh = await ensureFreshCalendarConnection(connection);
  const startDateTime = `${date}T00:00:00+12:00`;
  const endDateTime = `${date}T23:59:59+12:00`;
  const url = new URL("https://graph.microsoft.com/v1.0/me/calendarView");
  url.searchParams.set("startDateTime", startDateTime);
  url.searchParams.set("endDateTime", endDateTime);
  url.searchParams.set("$top", "16");
  url.searchParams.set("$orderby", "start/dateTime");
  const json = await fetchJson(url.toString(), {
    headers: {
      Authorization: `Bearer ${fresh.access_token}`,
      Prefer: 'outlook.timezone="Pacific/Auckland"',
    },
  });
  return ((json.value ?? []) as Array<Record<string, any>>).map((event) => {
    const mapped: CalendarEventLite = {
      title: event.subject || "Busy",
      start: event.start?.dateTime,
      end: event.end?.dateTime,
      location: event.location?.displayName || "",
      online: Boolean(event.isOnlineMeeting || event.onlineMeetingUrl || event.location?.displayName?.match?.(ONLINE_WORDS)),
      provider: "outlook",
    };
    return { ...mapped, dressSignal: classifyCalendarEvent(mapped) };
  });
}
