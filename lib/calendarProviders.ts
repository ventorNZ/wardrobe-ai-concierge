import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type CalendarProvider = "google" | "outlook";

export type CalendarConnection = {
  id: string;
  profile_id: string;
  provider: CalendarProvider;
  access_token: string;
  refresh_token?: string | null;
  expires_at?: string | null;
  email?: string | null;
};

export type CalendarEventLite = {
  title: string;
  start?: string;
  end?: string;
  location?: string;
  online?: boolean;
  provider?: CalendarProvider;
};

function baseUrlFromRequest(url: string) {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

export function calendarRedirectUri(requestUrl: string, provider: CalendarProvider) {
  return `${baseUrlFromRequest(requestUrl)}/api/calendar/callback/${provider}`;
}

export function googleAuthUrl(requestUrl: string, profileId: string) {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  if (!clientId) throw new Error("Missing GOOGLE_CALENDAR_CLIENT_ID");
  const state = Buffer.from(JSON.stringify({ provider: "google", profileId })).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", calendarRedirectUri(requestUrl, "google"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email https://www.googleapis.com/auth/calendar.readonly");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export function outlookAuthUrl(requestUrl: string, profileId: string) {
  const clientId = process.env.OUTLOOK_CALENDAR_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) throw new Error("Missing OUTLOOK_CALENDAR_CLIENT_ID or MICROSOFT_CLIENT_ID");
  const state = Buffer.from(JSON.stringify({ provider: "outlook", profileId })).toString("base64url");
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
  const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as { provider: CalendarProvider; profileId: string };
  if (!parsed.profileId || !["google", "outlook"].includes(parsed.provider)) throw new Error("Invalid OAuth state");
  return parsed;
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error_description || json.error?.message || json.error || `Calendar API failed: ${response.status}`);
  return json;
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

export async function saveCalendarConnection(profileId: string, provider: CalendarProvider, token: { access_token: string; refresh_token?: string; expires_in?: number }) {
  const supabaseAdmin = getSupabaseAdmin();
  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;
  const payload = {
    owner_id: "demo-user",
    profile_id: profileId,
    provider,
    access_token: token.access_token,
    refresh_token: token.refresh_token || null,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  };
  const saved = await supabaseAdmin
    .from("calendar_connections")
    .upsert(payload, { onConflict: "profile_id,provider" })
    .select("id")
    .single();
  if (saved.error) throw saved.error;
  return saved.data;
}

export async function listCalendarConnections(profileId: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("calendar_connections")
    .select("*")
    .eq("profile_id", profileId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CalendarConnection[];
}

export function eventLooksOnline(event: CalendarEventLite) {
  const text = `${event.title || ""} ${event.location || ""}`.toLowerCase();
  return Boolean(event.online || /zoom|teams|google meet|meet\.google|webex|online|virtual|video|https?:\/\//.test(text));
}

export function summariseCalendarEvents(events: CalendarEventLite[]) {
  if (!events.length) return "Calendar connected: no events today. Dress for weather, comfort and your personal plans.";
  const online = events.filter(eventLooksOnline);
  const inPerson = events.filter((event) => !eventLooksOnline(event));
  const titles = events.slice(0, 5).map((event) => event.title).filter(Boolean).join("; ");

  if (online.length && !inPerson.length) {
    return `Calendar: online meetings only (${titles}). Dress camera-smart on top, comfortable below; do not default to a full suit.`;
  }
  if (online.length && inPerson.length) {
    return `Calendar: mix of online and in-person plans (${titles}). Use smart separates, layers, and shoes practical enough to leave the house.`;
  }
  if (inPerson.length) {
    return `Calendar: in-person plans (${titles}). Use smart/practical separates and weather-safe shoes; full suit only if the event title says formal or client dress code.`;
  }
  return `Calendar: ${titles}. Use this as context, but do not over-formalise.`;
}

export async function fetchGoogleEvents(connection: CalendarConnection, date: string) {
  const timeMin = `${date}T00:00:00+12:00`;
  const timeMax = `${date}T23:59:59+12:00`;
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "12");
  const json = await fetchJson(url.toString(), { headers: { Authorization: `Bearer ${connection.access_token}` } });
  return ((json.items ?? []) as Array<Record<string, any>>).map((event) => ({
    title: event.summary || "Busy",
    start: event.start?.dateTime || event.start?.date,
    end: event.end?.dateTime || event.end?.date,
    location: event.location || "",
    online: Boolean(event.hangoutLink || event.conferenceData),
    provider: "google" as CalendarProvider,
  }));
}

export async function fetchOutlookEvents(connection: CalendarConnection, date: string) {
  const startDateTime = `${date}T00:00:00+12:00`;
  const endDateTime = `${date}T23:59:59+12:00`;
  const url = new URL("https://graph.microsoft.com/v1.0/me/calendarView");
  url.searchParams.set("startDateTime", startDateTime);
  url.searchParams.set("endDateTime", endDateTime);
  url.searchParams.set("$top", "12");
  url.searchParams.set("$orderby", "start/dateTime");
  const json = await fetchJson(url.toString(), {
    headers: {
      Authorization: `Bearer ${connection.access_token}`,
      Prefer: 'outlook.timezone="Pacific/Auckland"',
    },
  });
  return ((json.value ?? []) as Array<Record<string, any>>).map((event) => ({
    title: event.subject || "Busy",
    start: event.start?.dateTime,
    end: event.end?.dateTime,
    location: event.location?.displayName || "",
    online: Boolean(event.isOnlineMeeting || event.onlineMeetingUrl),
    provider: "outlook" as CalendarProvider,
  }));
}
