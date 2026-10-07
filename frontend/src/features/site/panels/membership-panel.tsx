"use client";

import { Button } from "@/components/ui/button";

/** Placeholder: the passes agent replaces this file with the plan picker. */
export default function MembershipPanel({ branchSlug, onClose }: { branchSlug?: string; onClose(): void }) {
  return (
    <div className="space-y-4 text-sm text-body">
      <p>Paket membership{branchSlug ? ` cabang ${branchSlug}` : ""} segera tampil di sini.</p>
      <Button asChild variant="ink">
        <a href="/join">Lihat paket</a>
      </Button>
      <Button variant="ghost" onClick={onClose}>
        Tutup
      </Button>
    </div>
  );
}
