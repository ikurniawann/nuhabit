/**
 * Unlink kartu NFC member (permintaan owner 2026-09-01): kartu dilepas
 * karena hilang atau dikembalikan, TANPA mereset saldo ARK/XP. Alasan
 * wajib diisi supaya jejak auditnya jelas.
 */

/** Alasan yang bisa dipilih kasir di dialog Unlink. */
export const CARD_UNLINK_REASONS = ["lost", "returned", "other"] as const;
/** 'refund' hanya dibuat lewat alur Refund (unlink + permintaan refund). */
export type CardUnlinkReason = (typeof CARD_UNLINK_REASONS)[number] | "refund";

export const CARD_UNLINK_REASON_LABELS: Record<CardUnlinkReason, string> = {
  lost: "Kartu hilang",
  returned: "Kartu dikembalikan",
  other: "Lainnya",
  refund: "Refund (kartu dilepas)",
};

export type CardUnlinkValidation =
  | { ok: true; reason: CardUnlinkReason; notes: string | null }
  | { ok: false; error: string };

export function validateCardUnlink(input: {
  reason?: unknown;
  notes?: unknown;
}): CardUnlinkValidation {
  const reason = String(input.reason ?? "").trim() as CardUnlinkReason;
  if (!(CARD_UNLINK_REASONS as readonly string[]).includes(reason)) {
    return { ok: false, error: "Alasan unlink wajib dipilih (hilang / dikembalikan / lainnya)" };
  }
  const notes = String(input.notes ?? "").trim();
  if (reason === "other" && notes.length < 3) {
    return { ok: false, error: "Tuliskan keterangan alasannya (minimal 3 karakter)" };
  }
  if (notes.length > 500) {
    return { ok: false, error: "Keterangan maksimal 500 karakter" };
  }
  return { ok: true, reason, notes: notes || null };
}
