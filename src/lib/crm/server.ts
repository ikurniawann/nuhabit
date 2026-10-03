import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUser } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { userHasIamPrefix } from "@/lib/iam/has-menu";
import type { UserRole } from "@/types";

/** @deprecated Gate memakai menu IAM crm.settings. */
export const CRM_CONFIG_ROLES: UserRole[] = ["super_admin"];

async function denyUnlessIam(
  prefixes: readonly string[]
): Promise<NextResponse | null> {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }
  if (!(await userHasIamPrefix(user.id, user.role, prefixes))) {
    return NextResponse.json(
      { success: false, error: "Insufficient permissions" },
      { status: 403 }
    );
  }
  return null;
}

export async function requireCrmConfigRole(): Promise<NextResponse | null> {
  return denyUnlessIam(IAM.crmSettings);
}

export async function requireCrmEngagementRole(): Promise<NextResponse | null> {
  return denyUnlessIam(IAM.crmEngagement);
}

// Klaim/approve redeem reward adalah operasi harian di venue, bukan konfigurasi —
// kasir & supervisor boleh, selain itu ditolak (EPIC-011 Fase F).
export const CRM_OPERATOR_ROLES: UserRole[] = [
  "super_admin",
  "admin",
  "pos",
  "pos_supervisor",
];

// Data redemption memuat PII member (nama, telepon, XP). Hanya peran dengan
// kebutuhan bisnis yang boleh membacanya — direksi ikut karena laporan CRM.
export const CRM_READ_ROLES: UserRole[] = [...CRM_OPERATOR_ROLES, "direksi"];

// Inbox WhatsApp CS (EPIC-012 Fase C) — isi chat customer adalah PII paling
// sensitif di CRM; kasir biasa (pos) sengaja TIDAK termasuk, hanya supervisor.
export const CRM_INBOX_ROLES: UserRole[] = ["super_admin", "admin", "pos_supervisor"];

// EPIC-013 — approver balasan ulasan bintang rendah. Subset dari
// CRM_INBOX_ROLES: pos_supervisor (agent CS harian) mengajukan draft,
// admin/super_admin yang menyetujui/menolak — balasan pada ulasan buruk
// tampil publik dan paling berisiko bagi citra bisnis.
export const CRM_REVIEW_APPROVER_ROLES: UserRole[] = ["super_admin", "admin"];

// EPIC-033 — kampanye marketing WA: pengelola = super_admin + marketing
// (role EPIC-032 A4). Master switch pengiriman TIDAK di sini (lihat
// campaign-config: PUT-nya super_admin only).
export const CRM_CAMPAIGN_ROLES: UserRole[] = ["super_admin", "marketing"];

async function requireCrmMenus(prefixes: readonly string[]): Promise<
  { error: NextResponse; user: null } | { error: null; user: { id: string; role: UserRole } }
> {
  const user = await getApiUser();
  if (!user) {
    return {
      error: NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      ),
      user: null,
    };
  }
  if (!(await userHasIamPrefix(user.id, user.role, prefixes))) {
    return {
      error: NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      ),
      user: null,
    };
  }
  return { error: null, user: { id: user.id, role: user.role } };
}

export function requireCrmCampaign() {
  return requireCrmMenus(IAM.crmPromo);
}

export function requireCrmOperator() {
  return requireCrmMenus([...IAM.crmLoyalty, ...IAM.crmMembers, ...IAM.posOperations]);
}

export function requireCrmReader() {
  return requireCrmMenus([...IAM.crmReports, ...IAM.crmMembers, ...IAM.crmLoyalty]);
}

export function requireCrmInboxAgent() {
  return requireCrmMenus(IAM.crmInbox);
}

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

export function validationErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { success: false, error: "Validation failed", details: error.issues },
      { status: 400 }
    );
  }

  return null;
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

/**
 * Persen bonus topup dari crm_settings (`topup_bonus_percent`) — EPIC-011
 * Fase C. Gagal baca/absen → 0 (tanpa bonus), tidak pernah melempar.
 */
export async function getCrmTopupBonusPercent(
  db: CrmSettingsClient
): Promise<number> {
  try {
    const { data, error } = await db
      .from("crm_settings")
      .select("value")
      .eq("key", "topup_bonus_percent")
      .maybeSingle();
    if (error || !data) return 0;
    const value = toNumber(data.value);
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : 0;
  } catch {
    return 0;
  }
}

export function apiErrorResponse(error: unknown, fallback = "Internal server error") {
  // Detail error (pesan Postgres dsb.) hanya di log server — jangan bocorkan
  // struktur internal ke client (temuan audit EPIC-011 Fase A).
  console.error("CRM API error:", error);
  return NextResponse.json({ success: false, error: fallback }, { status: 500 });
}
