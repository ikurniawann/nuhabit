"use client";

import { ReactNode } from "react";

export default function HRISLayout({ children }: { children: ReactNode }) {
  // Simplified layout - navigation handled by main sidebar
  // No top horizontal menu, cleaner interface
  return (
    // Padding hanya di desktop: di HP <main> sudah memberi jarak tepi (hindari gutter dobel).
    <div className="lg:p-6">
      {children}
    </div>
  );
}
