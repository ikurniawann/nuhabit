"use client";

import { Nfc, UserPlus, Users } from "lucide-react";

/** Kartu belum terdaftar: tautkan ke customer lama atau buat customer baru. */
export function CardChoiceView({
  nfcUid,
  onPickExisting,
  onCreateNew,
}: {
  nfcUid: string;
  onPickExisting: () => void;
  onCreateNew: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200/70 bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Nfc className="h-3.5 w-3.5" />
          Card ID
        </div>
        <div className="mt-1 font-mono text-base font-semibold tracking-wide text-foreground">{nfcUid}</div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={onPickExisting}
          className="flex items-center gap-3 rounded-xl border border-gray-200/70 bg-white px-4 py-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
        >
          <div className="grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
            <Users className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">Pilih customer yang sudah ada</div>
            <div className="text-xs text-muted-foreground">Link kartu ke member existing</div>
          </div>
        </button>
        <button
          type="button"
          onClick={onCreateNew}
          className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/10"
        >
          <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-brand-text">
            <UserPlus className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">Buat customer baru</div>
            <div className="text-xs text-muted-foreground">Daftar member baru + link kartu</div>
          </div>
        </button>
      </div>
    </div>
  );
}
