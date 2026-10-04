"use client";

import { formatReservationQueueNumber } from "@/lib/pos/reservation-queue";
import { reservationName, type summarizeQueue } from "../reservation-rules";

export function QueueSummaryCards({ summary }: { summary: ReturnType<typeof summarizeQueue> }) {
  const { nowServing, next, waitingCount } = summary;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-gray-200/70 bg-card px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Antrian Sekarang</div>
        {nowServing ? (
          <>
            <div className="mt-1 text-2xl font-bold tabular-nums text-brand-text">
              {formatReservationQueueNumber(nowServing.queue_number)}
            </div>
            <div className="truncate text-xs text-muted-foreground">{reservationName(nowServing)}</div>
          </>
        ) : (
          <div className="mt-1 text-2xl font-bold text-muted-foreground/50">—</div>
        )}
      </div>
      <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Siap-Siap Berikutnya</div>
        {next ? (
          <>
            <div className="mt-1 text-2xl font-bold tabular-nums text-amber-700">
              {formatReservationQueueNumber(next.queue_number)}
            </div>
            <div className="truncate text-xs font-medium text-amber-800">
              a/n {reservationName(next)} · {next.pax_count} orang
            </div>
          </>
        ) : (
          <div className="mt-1 text-2xl font-bold text-amber-700/40">—</div>
        )}
      </div>
      <div className="rounded-xl border border-gray-200/70 bg-card px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total Menunggu</div>
        <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">
          {waitingCount}
          <span className="ml-1.5 text-sm font-medium text-muted-foreground">antrian</span>
        </div>
      </div>
    </div>
  );
}
