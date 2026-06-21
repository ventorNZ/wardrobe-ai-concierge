#!/usr/bin/env node
const baseArg = process.argv[2] || process.env.APP_URL || "https://wardrobe-ai-concierge.vercel.app";
const base = baseArg.replace(/\/$/, "");
const mustPassRoutes = ["/", "/upload", "/wardrobe", "/planner", "/generate", "/stylist", "/dress-me", "/api/calendar/context"];
const seen = new Set();
const failures = [];

function normaliseHref(href) {
  if (!href) return null;
  if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return null;
  try {
    const url = new URL(href, `${base}/`);
    if (url.origin !== new URL(base).origin) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

async function check(path, source = "known route", options = {}) {
  const key = path || "/";
  if (seen.has(`${options.method || "GET"}:${key}`)) return "";
  seen.add(`${options.method || "GET"}:${key}`);
  const url = `${base}${key}`;
  let response;
  try {
    response = await fetch(url, { redirect: "follow", ...options });
  } catch (error) {
    failures.push({ path: key, source, status: "FETCH_ERROR", detail: error.message });
    return "";
  }
  const text = await response.text().catch(() => "");
  const bad = response.status >= 500 || response.status === 404 || /404\s*[:|-]?\s*not found/i.test(text) || /This page could not be found/i.test(text);
  console.log(`${bad ? "❌" : "✅"} ${String(response.status).padEnd(3)} ${options.method || "GET"} ${key} ${source ? `(${source})` : ""}`);
  if (bad) failures.push({ path: key, source, status: response.status, detail: response.url });
  return text;
}

for (const route of mustPassRoutes) {
  await check(route, "must-pass");
}

await check("/api/generate-outfit", "generation contract", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
});

for (const route of ["/", "/planner", "/generate", "/wardrobe", "/upload"]) {
  const html = await check(route, "crawl source");
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((match) => normaliseHref(match[1])).filter(Boolean);
  for (const href of hrefs) {
    if (href.startsWith("/_next") || href.includes("?")) continue;
    await check(href, `linked from ${route}`);
  }
}

if (failures.length) {
  console.error("\nBroken routes/buttons found:");
  for (const failure of failures) {
    console.error(`- ${failure.path} from ${failure.source}: ${failure.status} ${failure.detail || ""}`);
  }
  process.exit(1);
}

console.log(`\n✅ Route and generation-contract smoke test passed for ${base}`);
