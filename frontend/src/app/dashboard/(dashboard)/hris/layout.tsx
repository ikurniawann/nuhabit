"use client";

import { ReactNode } from "react";

export default function HRISLayout({ children }: { children: ReactNode }) {
  // Simplified layout - navigation handled by main sidebar
  // No top horizontal menu, cleaner interface
  return (
    <div className="p-6">
      {children}
    </div>
  );
}
