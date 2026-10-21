"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import type { SessionChangeKind } from "@/lib/studio/session-change";
import { formatDayLabel } from "../types";
import { EmptyState, Pill } from "./ui-bits";

/**
 * Laporan Program Director (EPIC-067 T-067-A6): perubahan jadwal yang
 * dikabarkan ke member via WA, dan mana yang terlambat (kurang dari minimal
 * jam sebelum kelas).
 */

interface ChangeRow {
  session_id: string;
  session_date: string;
  start_time: string;
  program_name: string;
  change_kind: SessionChangeKind;
  change_notice_late: boolean;
  coach_name: string | null;
  original_coach_name: string | null;
  sent: number;
  pending: number;
  failed: number;
  skipped: number;
}

export function SessionChangeReport({ minHours }: { minHours: number }) {
  const [rows, setRows] = useState<ChangeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ data: ChangeRow[] }>("/api/studio/coach-leave/changes")
      .then((r) => setRows(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat laporan"));
  }, []);

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <p className="text-[13px] font-semibold text-foreground">Kabar perubahan jadwal ke member</p>
      <p className="mt-0.5 text-sm text-muted-foreground">
        WA otomatis saat coach diganti atau kelas dibatalkan (14 hari terakhir & mendatang). Terlambat = dikabarkan kurang dari {minHours} jam sebelum kelas.
        Di luar 08.00–21.00 pesan ditahan sampai pagi, kecuali kelasnya terlalu dekat.
      </p>
      <div className="mt-4">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !rows ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : rows.length === 0 ? (
          <EmptyState title="Belum ada perubahan jadwal" />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows.map((r) => (
              <li key={r.session_id} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {formatDayLabel(r.session_date)} {r.start_time} · {r.program_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.change_kind === "cancelled"
                      ? "Kelas dibatalkan"
                      : `Coach diganti${r.original_coach_name ? `: ${r.original_coach_name} → ${r.coach_name ?? "-"}` : ` ke ${r.coach_name ?? "-"}`}`}
                    {" · "}
                    {[
                      `${r.sent} terkirim`,
                      r.pending > 0 && `${r.pending} menunggu jam kirim`,
                      r.failed > 0 && `${r.failed} gagal`,
                      r.skipped > 0 && `${r.skipped} tanpa nomor/lewat`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {r.change_notice_late && <Pill tone="warning">Terlambat</Pill>}
                  <Pill tone={r.change_kind === "cancelled" ? "danger" : "neutral"}>{r.change_kind === "cancelled" ? "Batal" : "Ganti coach"}</Pill>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
