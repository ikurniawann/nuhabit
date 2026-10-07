"use client";

import { Clock, Loader2, MessageSquare, Phone, Printer, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRupiah } from "@/lib/format";
import { formatReservationQueueNumber } from "@/lib/pos/reservation-queue";
import { cn } from "@/lib/utils";
import {
  reservationName,
  reservationPhone,
  reservationTime,
  statusMeta,
  type WhatsAppKind,
} from "../reservation-rules";
import type { ReservationRow, ReservationStatus } from "../types";

type CardActions = {
  onStatus: (id: string, status: ReservationStatus) => void;
  onWhatsApp: (reservation: ReservationRow, kind: WhatsAppKind) => void;
  onPrintQueue: (reservation: ReservationRow) => void;
};

function ActionButton({
  tone,
  busy,
  spinner = false,
  title,
  onClick,
  children,
}: {
  tone: "neutral" | "sky" | "emerald" | "red" | "muted";
  busy: boolean;
  spinner?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const toneClass = {
    neutral: "border-gray-200/80",
    sky: "border-sky-200/80 text-sky-700 hover:bg-sky-50",
    emerald: "border-emerald-200/80 text-emerald-700 hover:bg-emerald-50",
    red: "border-red-200/80 text-red-600 hover:bg-red-50",
    muted: "border-gray-200/80 text-muted-foreground",
  }[tone];
  return (
    <Button type="button" size="sm" variant="outline" className={toneClass} disabled={busy} title={title} onClick={onClick}>
      {spinner && busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </Button>
  );
}

export function ReservationCard({
  reservation,
  busy,
  onStatus,
  onWhatsApp,
  onPrintQueue,
}: CardActions & { reservation: ReservationRow; busy: boolean }) {
  const badge = statusMeta(reservation.status);
  const queueLabel = formatReservationQueueNumber(reservation.queue_number);
  const { id, status } = reservation;
  const waiting = status === "pending" || status === "confirmed";

  return (
    <div className="rounded-xl border border-gray-200/70 bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            {queueLabel ? (
              <span className="rounded-md bg-primary/10 px-2 py-0.5 text-sm font-bold tabular-nums text-brand-text">
                {queueLabel}
              </span>
            ) : null}
            <h3 className="truncate text-sm font-semibold text-foreground">{reservationName(reservation)}</h3>
            <Badge variant="outline" className={cn("font-medium", badge.className)}>
              {badge.label}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {reservationPhone(reservation)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              {reservation.pax_count} guests
            </span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="inline-flex items-center gap-1 text-sm font-medium text-foreground">
            <Clock className="h-4 w-4 text-muted-foreground" />
            {reservationTime(reservation)}
          </div>
          {reservation.table?.table_number ? (
            <div className="mt-0.5 text-xs text-muted-foreground">{reservation.table.table_number}</div>
          ) : null}
        </div>
      </div>

      {reservation.notes ? (
        <div className="mb-3 rounded-lg border border-gray-200/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {reservation.notes}
        </div>
      ) : null}
      {Number(reservation.deposit_amount || 0) > 0 ? (
        <div className="mb-3 text-xs font-medium text-emerald-700">Deposit: {formatRupiah(reservation.deposit_amount)}</div>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-gray-200/70 pt-3">
        {waiting && queueLabel ? (
          <>
            <ActionButton tone="neutral" busy={busy} title="Cetak slip nomor antrian" onClick={() => onPrintQueue(reservation)}>
              <Printer className="mr-1.5 h-3.5 w-3.5" />
              Antrian
            </ActionButton>
            <ActionButton
              tone="emerald"
              busy={busy}
              title="Kirim nomor antrian via WhatsApp"
              onClick={() => onWhatsApp(reservation, "queue")}
            >
              <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
              WA Antrian
            </ActionButton>
          </>
        ) : null}
        {status === "pending" ? (
          <>
            <ActionButton tone="sky" busy={busy} spinner onClick={() => onStatus(id, "confirmed")}>
              Confirm
            </ActionButton>
            <ActionButton tone="emerald" busy={busy} onClick={() => onWhatsApp(reservation, "confirmation")}>
              <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
              WhatsApp
            </ActionButton>
            <ActionButton tone="red" busy={busy} title="Batalkan reservasi" onClick={() => onStatus(id, "cancelled")}>
              <X className="h-3.5 w-3.5" />
            </ActionButton>
          </>
        ) : null}
        {status === "confirmed" ? (
          <>
            <ActionButton tone="emerald" busy={busy} spinner onClick={() => onStatus(id, "seated")}>
              Seat
            </ActionButton>
            <ActionButton tone="emerald" busy={busy} onClick={() => onWhatsApp(reservation, "reminder")}>
              <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
              Reminder
            </ActionButton>
            <ActionButton tone="muted" busy={busy} onClick={() => onStatus(id, "no_show")}>
              No show
            </ActionButton>
          </>
        ) : null}
        {status === "seated" ? (
          <ActionButton tone="neutral" busy={busy} spinner onClick={() => onStatus(id, "completed")}>
            Complete
          </ActionButton>
        ) : null}
      </div>
    </div>
  );
}
