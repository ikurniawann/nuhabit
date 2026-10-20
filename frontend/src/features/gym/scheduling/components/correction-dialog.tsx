"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { schedulingApi, type CorrectionAction } from "../api";

/** Koreksi yang menunggu konfirmasi staf. */
export interface PendingCorrection {
  id: string;
  action: CorrectionAction;
  memberName: string | null;
}

const COPY: Record<CorrectionAction, { title: string; description: string; label: string }> = {
  undo_check_in: {
    title: "Batalkan check-in?",
    description:
      "Kredit yang terpotong saat check-in dikembalikan dan booking kembali terdaftar. Member mendapat notifikasi.",
    label: "Batalkan check-in",
  },
  undo_no_show: {
    title: "Hapus status tidak hadir?",
    description:
      "Kredit yang hangus dikembalikan dan strike pass untuk kelas ini dihapus. Booking kembali terdaftar, jadi member bisa di-check-in manual.",
    label: "Hapus tidak hadir",
  },
};

/**
 * Konfirmasi koreksi staf (batalkan check-in atau tidak hadir) dengan alasan
 * wajib. Alasan tersimpan di audit log bersama akun staf.
 */
export function CorrectionDialog({
  pending,
  onClose,
  onDone,
}: {
  pending: PendingCorrection | null;
  onClose: () => void;
  onDone: () => void;
}) {
  // Keyed by booking, so the reason starts empty for every booking.
  const [reason, setReason] = useState({ id: "", text: "" });
  const text = pending && reason.id === pending.id ? reason.text : "";
  const correct = useMutation({
    mutationFn: (input: PendingCorrection & { reason: string }) =>
      schedulingApi.correctBooking(input.id, input.action, input.reason),
    onSuccess: (data) => {
      const parts = [
        data.refundedCredits > 0 ? `${data.refundedCredits} kredit dikembalikan` : "Tanpa kredit yang dikembalikan",
        data.strikeCleared ? "strike pass dihapus" : null,
      ].filter(Boolean);
      toast.success("Koreksi tersimpan", { description: `${parts.join(", ")}.` });
      onDone();
    },
    onError: (error) => toast.error("Koreksi gagal", { description: error.message }),
  });
  const copy = pending ? COPY[pending.action] : null;
  const valid = text.trim().length >= 3;

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="xs">
        <DialogPanelHeader>
          <DialogPanelTitle>{copy?.title}</DialogPanelTitle>
          <DialogPanelDescription>
            {pending?.memberName ? `${pending.memberName}. ${copy?.description}` : copy?.description}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Alasan koreksi</span>
            <Textarea
              value={text}
              onChange={(e) => pending && setReason({ id: pending.id, text: e.target.value })}
              placeholder="Contoh: salah member di-scan, member hadir tapi lupa scan"
              maxLength={500}
              aria-invalid={text.length > 0 && !valid}
            />
            <span className="text-xs text-muted-foreground">Wajib, minimal 3 karakter. Tercatat di audit log.</span>
          </label>
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={correct.isPending}>
            Batal
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!valid || correct.isPending}
            onClick={() => pending && correct.mutate({ ...pending, reason: text.trim() })}
          >
            {correct.isPending ? "Menyimpan…" : copy?.label}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
