import { supabase } from "@/lib/supabaseClient";
import type { WardrobeItem } from "@/lib/types";

export const dynamic = "force-dynamic";

async function getItems() {
  const { data, error } = await supabase
    .from("wardrobe_items")
    .select("*")
    .eq("is_archived", false)
    .order("created_at", { ascending: false })
    .limit(24);

  if (error) throw error;
  return (data ?? []) as WardrobeItem[];
}

function count(items: WardrobeItem[], predicate: (item: WardrobeItem) => boolean) {
  return items.filter(predicate).length;
}

export default async function HomePage() {
  const items = await getItems();
  const bodyRefs = count(items, (item) => item.category === "body_reference");
  const clothing = count(items, (item) => item.category !== "body_reference");
  const clean = count(items, (item) => !["needs_wash", "drying", "unavailable"].includes(item.laundry_status || "clean"));
  const inWash = count(items, (item) => item.laundry_status === "needs_wash");

  return (
    <div className="stack">
      <section className="concierge-hero card">
        <div className="concierge-copy">
          <span className="eyebrow">The Wardrobe</span>
          <h1>Your day, dressed and explained.</h1>
          <p className="lede">
            Build the AI wardrobe assistant you actually want: separate profiles for Manny and Yess, multi-angle wardrobe items, live-weather styling, voice briefs, saved sessions, and true per-look try-on previews.
          </p>
          <div className="button-row">
            <a className="primary-link" href="/upload">Bulk upload wardrobe</a>
            <a className="ghost-link" href="/planner">Open stylist briefing</a>
            <a className="ghost-link" href="/generate">Dress me</a>
          </div>
        </div>
        <div className="concierge-summary">
          <div className="summary-kpi"><strong>{bodyRefs}</strong><span>body references</span></div>
          <div className="summary-kpi"><strong>{clothing}</strong><span>wardrobe pieces</span></div>
          <div className="summary-kpi"><strong>{clean}</strong><span>available now</span></div>
          <div className="summary-kpi"><strong>{inWash}</strong><span>in wash</span></div>
        </div>
      </section>

      <section className="planner-preview card">
        <div className="section-title-row">
          <div>
            <span className="eyebrow">Suggested flow</span>
            <h2>How this should work.</h2>
          </div>
        </div>

        <div className="preview-grid">
          <article className="preview-step">
            <span className="step-number">01</span>
            <h3>Upload once</h3>
            <p>Use your iPhone to bulk upload every item. The vision agent recognises category, colour, brand, formality, season and fabric guess automatically.</p>
          </article>
          <article className="preview-step">
            <span className="step-number">02</span>
            <h3>Brief the day</h3>
            <p>Planner considers your meetings, weather, laundry state, and your professional profile: modern executive, polished, not unnecessarily corporate.</p>
          </article>
          <article className="preview-step">
            <span className="step-number">03</span>
            <h3>See it on you</h3>
            <p>Each recommended look now gets its own generated preview. The app no longer shows the raw body reference as a fake “on you” image.</p>
          </article>
        </div>
      </section>

      <section className="card wardrobe-overview">
        <div className="section-title-row">
          <div>
            <span className="eyebrow">Latest wardrobe uploads</span>
            <h2>Your visual inventory.</h2>
          </div>
          <a className="ghost-link" href="/wardrobe">View full wardrobe</a>
        </div>
        {items.length === 0 ? (
          <p>No items yet. Start in Bulk Upload and feed the assistant your wardrobe photos.</p>
        ) : (
          <div className="grid wardrobe-grid">
            {items.map((item) => (
              <article className="item-card wardrobe-card" key={item.id}>
                <img src={item.image_url} alt={item.name} />
                <div className="body">
                  <div className="card-kicker">
                    <span className="status-pill status-classified">{item.category.replaceAll("_", " ")}</span>
                    <span className="status-pill status-ready">{(item.laundry_status || "clean").replaceAll("_", " ")}</span>
                  </div>
                  <strong>{item.name}</strong>
                  <p>{[item.subcategory, item.brand, item.colour_primary || item.colour].filter(Boolean).join(" · ")}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
