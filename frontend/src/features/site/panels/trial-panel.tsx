"use client";

import { Button } from "@/components/ui/button";

/** Placeholder: the trial-funnel agent replaces this file with the lead form. */
export default function TrialPanel({ branchSlug, onClose }: { branchSlug?: string; onClose(): void }) {
  return (
    <div className="space-y-4 text-sm text-body">
      <p>
        Sesi percobaan gratis{branchSlug ? ` di cabang ${branchSlug}` : ""} bisa dipesan lewat WhatsApp sampai
        formulirnya tersedia di sini.
      </p>
      <Button asChild>
        <a href="/contact">Hubungi kami</a>
      </Button>
      <Button variant="ghost" onClick={onClose}>
        Tutup
      </Button>
    </div>
  );
}
