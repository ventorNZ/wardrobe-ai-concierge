import type { Metadata } from "next";
import "./styles.css";
import ProfileSwitcher from "@/components/ProfileSwitcher";

export const metadata: Metadata = {
  title: "The Wardrobe Concierge",
  description: "AI wardrobe styling, weather-aware looks, calendar-ready context, and visual try-on previews.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NZ">
      <body>
        <header className="app-shell-header">
          <a className="brand-lockup" href="/" aria-label="Wardrobe concierge home">
            <span className="brand-mark">✦</span>
            <span>
              <strong>Wardrobe Concierge</strong>
              <small>Two looks. Less tapping.</small>
            </span>
          </a>

          <nav className="top-nav" aria-label="Main navigation">
            <a href="/planner">Stylist</a>
            <a href="/generate">Try-on</a>
            <a href="/wardrobe">Closet</a>
            <a href="/upload">Add photos</a>
          </nav>

          <ProfileSwitcher />
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
