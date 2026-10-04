"use client";

import { useEffect } from "react";

interface PurchasingLayoutProps {
  children: React.ReactNode;
}

/**
 * Wrapper tipis untuk halaman Purchasing.
 *
 * Top-navbar khusus Purchasing sudah dihapus — navigasi sekarang sepenuhnya
 * mengikuti AppSidebar global (design system terbaru, sama seperti modul Items
 * & Inventory). Komponen ini hanya bertugas menandai body dengan class
 * `purchasing-ui` agar normalisasi ukuran input/textarea tetap berlaku.
 */
export function PurchasingLayout({ children }: PurchasingLayoutProps) {
  useEffect(() => {
    document.body.classList.add("purchasing-ui");
    return () => document.body.classList.remove("purchasing-ui");
  }, []);

  return <>{children}</>;
}
