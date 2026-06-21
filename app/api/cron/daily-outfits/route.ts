import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { nzTodayIso, NZ_TIME_ZONE } from "@/lib/nzTime";
import { recommendOutfits, saveStylistSession } from "@/lib/serverStylist";
import { generateOutfitPreview } from "@/lib/serverGenerate";
import type { WardrobeItem, WardrobeProfile } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

function nzHour() {
  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TIME_ZONE,
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  return Number(parts.find((part) => part.type === "hour")?.value || "0");
}

async function getWeatherSummary() {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", "-36.8485");
  url.searchParams.set("longitude", "174.7633");
  url.searchParams.set("current", "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m");
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("timezone", NZ_TIME_ZONE);

  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) return "Auckland weather unavailable. Choose practical layers and weather-safe shoes.";
  const data = await response.json();
  const current = data.current ?? {};
  const daily = data.daily ?? {};
  const temp = Math.round(Number(current.temperature_2m ?? daily.temperature_2m_max?.[0] ?? 0));
  const feels = Math.round(Number(current.apparent_temperature ?? temp));
  const high = Math.round(Number(daily.temperature_2m_max?.[0] ?? temp));
  const low = Math.round(Number(daily.temperature_2m_min?.[0] ?? temp));
  const rain = Math.round(Number(daily.precipitation_probability_max?.[0] ?? 0));
  const wind = Math.round(Number(current.wind_speed_10m ?? 0));
  return `Auckland/NZ morning forecast: ${temp}°C now, feels ${feels}°C, high ${high}° / low ${low}°, rain ${rain}%, wind ${wind} km/h.`;
}

async function calendarContextForProfile(profile: WardrobeProfile, date: string) {
  // Placeholder for user-connected calendars. Keep the text brief so the stylist can still run without a calendar connection.
  // Future hook: read per-profile Google Calendar / Outlook provider settings and summarise events for the NZ date.
  return `Calendar for ${profile.display_name} on ${date}: no connected calendar yet. Use general daily practicality unless the user adds a brief.`;
}

function bodyReference(items: WardrobeItem[], preferredId?: string | null) {
  return items.find((item) => item.category === "body_reference" && item.id === preferredId) || items.find((item) => item.category === "body_reference") || null;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") || "";
  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "1";

  if (secret && auth !== `Bearer ${secret}` && !force) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!force && nzHour() !== 5) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Not 5am in Pacific/Auckland" });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const selectedDate = nzTodayIso();
  const weather = await getWeatherSummary();

  const { data: profiles, error: profileError } = await supabaseAdmin
    .from("wardrobe_profiles")
    .select("*")
    .order("display_name", { ascending: true });
  if (profileError) throw profileError;

  const results = [];

  for (const profile of (profiles ?? []) as WardrobeProfile[]) {
    try {
      const { data: existing } = await supabaseAdmin
        .from("stylist_sessions")
        .select("id,last_recommendation")
        .eq("profile_id", profile.id)
        .eq("selected_date", selectedDate)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const calendar = await calendarContextForProfile(profile, selectedDate);
      const input = {
        profileId: profile.id,
        selectedDate,
        sessionId: existing?.id || undefined,
        bodyId: profile.default_body_item_id || undefined,
        dayContext: calendar,
        weather,
        vibe: profile.style_profile || "Polished, practical, weather-aware.",
      };

      const { recommendation, items } = await recommendOutfits(input);
      const sessionId = await saveStylistSession(input, recommendation);
      const body = bodyReference(items, profile.default_body_item_id);
      let generated = 0;

      if (body && sessionId) {
        for (let index = 0; index < Math.min(2, recommendation.outfits.length); index += 1) {
          const outfit = recommendation.outfits[index];
          const selected = outfit.item_ids
            .map((id) => items.find((item) => item.id === id))
            .filter(Boolean) as WardrobeItem[];
          if (!selected.length) continue;
          try {
            await generateOutfitPreview({
              profileId: profile.id,
              sessionId,
              lookLabel: index === 0 ? "A" : "B",
              body,
              selected,
              occasion: `${selectedDate} auto-morning wardrobe run`,
              weather,
              notes: `${outfit.summary}\n${outfit.why_it_works}`,
            });
            generated += 1;
          } catch (imageError) {
            console.error(`Morning image generation failed for ${profile.display_name}`, imageError);
          }
        }
      }

      results.push({ profile: profile.display_name, sessionId, outfits: recommendation.outfits.length, generated });
    } catch (error) {
      results.push({ profile: profile.display_name, error: error instanceof Error ? error.message : "Failed" });
    }
  }

  return NextResponse.json({ ok: true, selectedDate, weather, results });
}
