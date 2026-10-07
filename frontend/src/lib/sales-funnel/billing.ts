/** Aturan tagihan deal (EPIC-022 Fase G / EPIC-025), bagian pure. */

export type PaymentStatus = "belum" | "sebagian" | "lunas";

/** Status pelunasan invoice diturunkan dari pembayaran, bukan dipilih manual. */
export function derivePaymentStatus(paid: number, amount: number): PaymentStatus {
  if (amount > 0 && paid >= amount) return "lunas";
  if (paid > 0) return "sebagian";
  return "belum";
}

/**
 * Tagihan acuan deal (prioritas): quotation DITERIMA terbaru → nilai final
 * deal (Menang) → quotation terbaru → estimasi.
 */
export function resolveReferenceTotal(
  refQuotation: { status: string; total: string | number } | null,
  deal: { value_final: string | number | null; value_estimate: string | number | null } | null
): number {
  if (refQuotation?.status === "diterima") return Number(refQuotation.total);
  if (deal?.value_final !== null && deal?.value_final !== undefined) return Number(deal.value_final);
  if (refQuotation) return Number(refQuotation.total);
  return Number(deal?.value_estimate ?? 0);
}

export const roundCents = (value: number) => Math.round(value * 100) / 100;
