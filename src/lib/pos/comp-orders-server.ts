import "server-only";
import { queryOne } from "@/lib/db";
import { KOL_COMP, kolQuotaAllows, monthStartWibIso } from "./comp-orders";

/**
 * Sisi SERVER komplimen (EPIC-043) — dipisah dari comp-orders.ts karena file
 * itu juga dipakai struk (komponen client): import @/lib/db (pg) di modul
 * yang tersentuh client menyeret driver DB ke bundle browser (build error
 * "Can't resolve 'dns'"), bahkan lewat dynamic import.
 */

/**
 * Validasi server komplimen KOL: customer harus bertanda is_kol dan kuota
 * bulanan (bila diset) mencukupi. grossIdr = subtotal SEBELUM diskon.
 */
export async function validateKolComp(input: {
  customerId: string;
  grossIdr: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const customer = await queryOne<{
    is_kol: boolean;
    kol_monthly_limit_idr: string | null;
    name: string | null;
  }>(
    `SELECT is_kol, kol_monthly_limit_idr, name
     FROM pos.pos_customers WHERE id = $1`,
    [input.customerId]
  ).catch((error) => {
    // 42703 = kolom belum di-migrate → fitur KOL belum aktif di env ini.
    if ((error as { code?: string })?.code === "42703") return null;
    throw error;
  });
  if (!customer) {
    return { ok: false, reason: "Customer tidak ditemukan / fitur KOL belum aktif (migrasi 015)" };
  }
  if (!customer.is_kol) {
    return { ok: false, reason: `${customer.name || "Customer"} bukan KOL — komplimen KOL ditolak` };
  }

  const limit =
    customer.kol_monthly_limit_idr == null ? null : Number(customer.kol_monthly_limit_idr);
  if (limit == null) return { ok: true };

  const used = await queryOne<{ used: string }>(
    `SELECT COALESCE(SUM(subtotal), 0) AS used
     FROM pos.pos_orders
     WHERE customer_id = $1
       AND comp_type = '${KOL_COMP}'
       AND status NOT IN ('cancelled', 'voided', 'merged')
       AND ordered_at >= $2`,
    [input.customerId, monthStartWibIso()]
  );

  return kolQuotaAllows({
    monthlyLimitIdr: limit,
    usedThisMonthIdr: Number(used?.used) || 0,
    orderGrossIdr: input.grossIdr,
  });
}
