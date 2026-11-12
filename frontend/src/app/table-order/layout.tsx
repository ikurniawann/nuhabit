import type { Metadata, Viewport } from "next";
import { brandName } from "@/lib/branding";

export const metadata: Metadata = {
  title: `Pesan dari Meja · ${brandName()}`,
  description: "Pesan menu langsung dari meja lewat QR — bayar QRIS, ARK Coin, atau di kasir.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#00281a",
};

// The guest app paints light surfaces, so it keeps the light tokens even when
// the device stored dark mode for the dashboard.
export default function TableOrderLayout({ children }: { children: React.ReactNode }) {
  return <div className="theme-light">{children}</div>;
}
