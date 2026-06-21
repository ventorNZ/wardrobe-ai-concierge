import type { Metadata } from "next";
import Link from "next/link";
import "./styles.css";
import ProfileSwitcher from "@/components/ProfileSwitcher";

export const metadata: Metadata = {
  title: "The Wardrobe Concierge",
  description:
    "AI wardrobe ingestion, outfit planning, and realistic outfit preview on your own body reference.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-NZ">
      <body>
        <nav className="nav">
          <div className="nav-inner">
            <Link href="/" className="brand">
              <span className="brand-mark">✦</span>
              <span className="brand-copy">
                <strong>The Wardrobe AI concierge</strong>
                <em>Personal styling, weather, and try-on previews</em>
              </span>
            </Link>

            <div className="links">
              <Link href="/upload">Upload</Link>
              <Link href="/wardrobe">Wardrobe</Link>
              <Link href="/stylist">Stylist</Link>
              <Link href="/dress-me">Dress Me</Link>
              <ProfileSwitcher />
            </div>
          </div>
        </nav>

        <main className="container">{children}</main>
      </body>
    </html>
  );
}
