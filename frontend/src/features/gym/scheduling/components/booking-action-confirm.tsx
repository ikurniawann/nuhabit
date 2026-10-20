"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export type ConfirmableBookingAction = "cancel" | "no_show";

/** A cancel or no-show waiting for the staff member to confirm it. */
export interface PendingBookingAction {
  id: string;
  action: ConfirmableBookingAction;
  memberName: string | null;
  /** Leaving the waitlist never costs anything, so no waiver is offered. */
  waitlist: boolean;
}

const COPY = {
  cancel: {
    title: "Batalkan booking ini?",
    description:
      "Batal setelah batas gratis mengikuti aturan gym: kredit hangus, atau satu strike untuk pemegang pass. Kursi yang kosong diberikan ke waitlist.",
    label: "Batalkan booking",
  },
  waitlist: {
    title: "Keluarkan dari waitlist?",
    description: "Member keluar dari waitlist tanpa potongan kredit.",
    label: "Keluarkan",
  },
  no_show: {
    title: "Tandai tidak hadir?",
    description: "Kredit hangus sesuai kebijakan no-show, atau satu strike untuk pemegang pass.",
    label: "Tandai tidak hadir",
  },
} as const;

/** Konfirmasi Batalkan dan Tidak hadir; batal oleh staf bisa tanpa penalti. */
export function BookingActionConfirm({
  pending,
  loading,
  onClose,
  onConfirm,
}: {
  pending: PendingBookingAction | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: (input: { id: string; action: ConfirmableBookingAction; waivePenalty: boolean }) => void;
}) {
  // Keyed by booking, so the box starts unticked for every booking.
  const [waivedFor, setWaivedFor] = useState<string | null>(null);
  const copy = pending ? COPY[pending.action === "cancel" && pending.waitlist ? "waitlist" : pending.action] : null;
  const canWaive = pending?.action === "cancel" && !pending.waitlist;
  const waive = canWaive && waivedFor === pending.id;

  return (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => !open && onClose()}
      title={copy?.title ?? ""}
      description={copy && (pending?.memberName ? `${pending.memberName}. ${copy.description}` : copy.description)}
      confirmLabel={copy?.label}
      loading={loading}
      onConfirm={() => pending && onConfirm({ id: pending.id, action: pending.action, waivePenalty: waive })}
    >
      {canWaive && (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={waive}
            onCheckedChange={(v) => setWaivedFor(v ? pending.id : null)}
          />
          <span>
            Tanpa penalti
            <span className="block text-xs text-muted-foreground">
              Kredit tidak hangus dan tidak ada strike, walau sudah lewat batas batal gratis.
            </span>
          </span>
        </label>
      )}
    </ConfirmDialog>
  );
}
