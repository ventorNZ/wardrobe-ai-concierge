import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "The Wardrobe Concierge",
  description: "AI wardrobe ingestion, outfit planning, and realistic outfit preview on your own body reference."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <div className="nav-inner">
            <a href="/" className="brand" aria-label="The Wardrobe home">
              <span className="brand-mark">✦</span>
              <span className="brand-copy">
                <strong>The Wardrobe</strong>
                <em>AI concierge</em>
              </span>
            </a>
            <div className="links">
              <a href="/upload">Upload</a>
              <a href="/wardrobe">Wardrobe</a>
              <a href="/planner">Stylist</a>
              <a href="/generate">Dress Me</a>
            </div>
          </div>
        </nav>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
