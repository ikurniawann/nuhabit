import type { DbClient } from "@/lib/pg/types";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import { queryOne } from "@/lib/db";

/**
 * Venue untuk transaksi topup (permintaan owner 2026-09-04).
 *
 * Sebelumnya topup disimpan tanpa company/branch sehingga selalu muncul
 * sebagai "Tanpa venue" di Rekonsiliasi ARK. Urutan penentuan:
 *   1. cabang kasir yang login (configuration.users.branch_id/company_id);
 *      bila hanya branch yang terisi, company diturunkan dari cabangnya;
 *   2. venue default CRM (crm_settings default_company_id/default_branch_id);
 *   3. null — tidak pernah melempar; topup tidak boleh gagal karena venue.
 */

export interface TopupVenue {
  companyId: string | null;
  branchId: string | null;
}

/** Pure: pilih venue dari profil user, lalu fallback. */
export function pickTopupVenue(
  user: { company_id?: string | null; branch_id?: string | null } | null | undefined,
  fallback: TopupVenue
): TopupVenue {
  const branchId = user?.branch_id ?? null;
  const companyId = user?.company_id ?? null;
  if (branchId || companyId) {
    return { companyId, branchId };
  }
  return { companyId: fallback.companyId ?? null, branchId: fallback.branchId ?? null };
}

export async function resolveTopupVenue(db: DbClient, userId: string): Promise<TopupVenue> {
  try {
    const user = await queryOne<{ company_id: string | null; branch_id: string | null }>(
      `SELECT company_id, branch_id FROM configuration.users WHERE id = $1`,
      [userId]
    );
    const fallback = await getCrmDefaultVenue(db);
    const picked = pickTopupVenue(user, fallback);
    // Branch terisi tapi company kosong → ambil dari cabangnya.
    if (picked.branchId && !picked.companyId) {
      const br = await queryOne<{ company_id: string | null }>(
        `SELECT company_id FROM configuration.branches WHERE id = $1`,
        [picked.branchId]
      );
      return { companyId: br?.company_id ?? null, branchId: picked.branchId };
    }
    return picked;
  } catch (err) {
    console.error("[pos] resolveTopupVenue gagal — topup tetap diproses tanpa venue:", err);
    return { companyId: null, branchId: null };
  }
}
