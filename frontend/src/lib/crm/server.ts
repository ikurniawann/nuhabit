import type { UserRole } from "@/types";

// EPIC-013 — approver balasan ulasan bintang rendah: agent CS harian
// mengajukan draft, admin/super_admin yang menyetujui/menolak — balasan pada
// ulasan buruk tampil publik dan paling berisiko bagi citra bisnis.
export const CRM_REVIEW_APPROVER_ROLES: UserRole[] = ["super_admin", "admin"];

export const CRM_DEFAULT_TIERS = [
  {
    code: "regular",
    name: "Regular",
    rank: 0,
    min_lifetime_xp: 0,
    min_total_spend: 0,
    xp_multiplier: 1,
    discount_percent: 0,
    display_color: "#6B7280",
  },
  {
    code: "bronze",
    name: "Bronze",
    rank: 1,
    min_lifetime_xp: 0,
    min_total_spend: 0,
    xp_multiplier: 1,
    discount_percent: 0,
    display_color: "#B7791F",
  },
  {
    code: "silver",
    name: "Silver",
    rank: 2,
    min_lifetime_xp: 10000,
    min_total_spend: 2000000,
    xp_multiplier: 1.2,
    discount_percent: 5,
    display_color: "#94A3B8",
  },
  {
    code: "gold",
    name: "Gold",
    rank: 3,
    min_lifetime_xp: 30000,
    min_total_spend: 7000000,
    xp_multiplier: 1.5,
    discount_percent: 10,
    display_color: "#F59E0B",
  },
];

export function isMissingCrmSchema(error: unknown) {
  if (!error) return false;
  const candidate = error as { code?: string; message?: string };
  const message = candidate.message ?? "";

  return (
    candidate.code === "42P01"
    || candidate.code === "42703"
    || message.includes("Could not find the table")
    || message.includes("Could not find a relationship")
    || message.includes("schema cache")
  );
}

export function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

interface CrmSettingsClient {
  from: (table: string) => {
    select: (cols: string) => {
      in: (col: string, values: string[]) => PromiseLike<{
        data: Array<{ key: string; value: unknown }> | null;
        error: unknown;
      }>;
    };
  };
}

/**
 * Venue default (single-venue) dari crm_settings untuk stempel transaksi
 * wallet/XP — dasar rekonsiliasi antar-venue (EPIC-011). Gagal baca → null.
 */
export async function getCrmDefaultVenue(db: CrmSettingsClient): Promise<{
  companyId: string | null;
  branchId: string | null;
}> {
  try {
    const { data, error } = await db
      .from("crm_settings")
      .select("key, value")
      .in("key", ["default_company_id", "default_branch_id"]);
    if (error || !data) return { companyId: null, branchId: null };

    const map = Object.fromEntries(
      data.map((row) => [row.key, typeof row.value === "string" ? row.value : null])
    );
    return {
      companyId: map.default_company_id ?? null,
      branchId: map.default_branch_id ?? null,
    };
  } catch {
    return { companyId: null, branchId: null };
  }
}
