import type { CreditLot } from "./api";

export type TransferPicks = { ok: true; lots: { lot_id: string; credits: number }[] } | { ok: false; error: string };

/**
 * Jumlah per lot yang diisi staf menjadi daftar lot untuk API transfer.
 * Kolom kosong atau 0 dilewati; jumlah harus bilangan bulat dan tidak
 * melebihi sisa lot.
 */
export function transferPicks(lots: Pick<CreditLot, "id" | "remaining">[], amounts: Record<string, string>): TransferPicks {
  const picks: { lot_id: string; credits: number }[] = [];
  for (const lot of lots) {
    const raw = (amounts[lot.id] ?? "").trim();
    if (raw === "") continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) return { ok: false, error: "Jumlah kredit harus bilangan bulat." };
    if (n > lot.remaining) return { ok: false, error: `Sisa lot hanya ${lot.remaining} kredit.` };
    if (n > 0) picks.push({ lot_id: lot.id, credits: n });
  }
  return { ok: true, lots: picks };
}
