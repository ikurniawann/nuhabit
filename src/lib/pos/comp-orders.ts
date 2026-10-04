import { formatRupiah } from "@/lib/format";
/**
 * EPIC-043: Complimentary orders — KOL (gratis otomatis, tercatat penuh)
 * dan Owner Comp (open bill diselesaikan gratis dengan PIN supervisor).
 *
 * Prinsip: order komplimen tetap tercatat LENGKAP (item, subtotal gross,
 * diskon = subtotal, total 0) supaya laporan bisa menghitung nilai barang
 * yang digratiskan; comp_type + comp_approved_* menjawab "siapa & kenapa".
 */

export const KOL_COMP = "kol_comp";
export const OWNER_COMP = "owner_comp";
/** Metode bayar FOC (Free of Charge) — digerbang PIN supervisor di server. */
export const FOC_COMP = "foc_comp";
export const COMP_TYPES = [KOL_COMP, OWNER_COMP, FOC_COMP] as const;
export type CompType = (typeof COMP_TYPES)[number];

export function isCompType(value: unknown): value is CompType {
  return value === KOL_COMP || value === OWNER_COMP || value === FOC_COMP;
}

/** Label struk/laporan per jenis komplimen. */
export function compReceiptLabel(
  compType?: string | null,
  approvedName?: string | null
): string | null {
  if (compType === KOL_COMP) return "KOL COMPLIMENTARY — GRATIS";
  if (compType === OWNER_COMP) {
    return `OWNER COMP — Disetujui: ${approvedName?.trim() || "-"}`;
  }
  if (compType === FOC_COMP) {
    return `FOC (FREE OF CHARGE) — Disetujui: ${approvedName?.trim() || "-"}`;
  }
  return null;
}

/**
 * Kuota bulanan KOL (pure, unit-testable): limit NULL = tanpa batas;
 * selain itu pemakaian bulan berjalan + order baru tidak boleh melebihi.
 */
export function kolQuotaAllows(input: {
  monthlyLimitIdr: number | null;
  usedThisMonthIdr: number;
  orderGrossIdr: number;
}): { ok: true } | { ok: false; reason: string } {
  if (input.monthlyLimitIdr == null) return { ok: true };
  const after = input.usedThisMonthIdr + input.orderGrossIdr;
  if (after <= input.monthlyLimitIdr + 0.5) return { ok: true };
  const fmt = formatRupiah;
  return {
    ok: false,
    reason: `Kuota komplimen KOL bulan ini terlampaui (terpakai ${fmt(input.usedThisMonthIdr)} dari ${fmt(input.monthlyLimitIdr)}, order ini ${fmt(input.orderGrossIdr)})`,
  };
}

/** Awal bulan berjalan dalam WIB → ISO UTC utk filter ordered_at. */
export function monthStartWibIso(now = new Date()): string {
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
  return new Date(`${y}-${m}-01T00:00:00+07:00`).toISOString();
}
