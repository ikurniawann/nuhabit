/**
 * EPIC-050 Fase 2 (T-2.4) — approval diskon quotation, bagian murni.
 * Default ambang (keputusan owner 2026-09-13): >10% → admin, >20% → super_admin;
 * konfigurable di crm.crm_approval_rules.
 */
import { z } from "zod";

export const approvalRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    level: z.number().int().min(1).max(5),
    min_discount_percent: z.number().min(0).max(100),
    approver_role: z.string().trim().max(40).optional().nullable(),
    approver_user_id: z.string().uuid().optional().nullable(),
    is_active: z.boolean().default(true),
  })
  .refine((r) => Boolean(r.approver_role) || Boolean(r.approver_user_id), {
    message: "Pilih role atau user approver",
  });
export type ApprovalRuleInput = z.infer<typeof approvalRuleSchema>;

export interface ApprovalRule {
  id: string;
  level: number;
  min_discount_percent: number;
  approver_role: string | null;
  approver_user_id: string | null;
}

/**
 * Tingkat approval yang wajib dilalui untuk diskon tertentu: semua aturan
 * dengan ambang < diskon, diurutkan per level (satu aturan per level —
 * bila ada dua aturan di level sama, ambil yang ambangnya tertinggi yang masih terlewati).
 */
export function requiredApprovalLevels(discountPercent: number, rules: ApprovalRule[]): ApprovalRule[] {
  const passed = rules.filter((r) => discountPercent > Number(r.min_discount_percent));
  const byLevel = new Map<number, ApprovalRule>();
  for (const rule of passed) {
    const existing = byLevel.get(rule.level);
    if (!existing || Number(rule.min_discount_percent) > Number(existing.min_discount_percent)) {
      byLevel.set(rule.level, rule);
    }
  }
  return Array.from(byLevel.values()).sort((a, b) => a.level - b.level);
}

/** Apakah user boleh memutuskan step ini (role cocok ATAU user ditunjuk). */
export function canDecideStep(
  step: { approver_role: string | null; approver_user_id: string | null },
  user: { id: string; role: string }
): boolean {
  if (step.approver_user_id) return step.approver_user_id === user.id;
  if (step.approver_role) {
    // super_admin selalu boleh mewakili tingkat di bawahnya
    return step.approver_role === user.role || user.role === "super_admin";
  }
  return false;
}

/** Hitung nominal diskon & total akhir (2dp, PPN dihitung setelah diskon). */
export function applyDiscount(
  subtotal: number,
  discountPercent: number,
  usePpn: boolean,
  ppnPersen: number
): { discountNominal: number; dpp: number; ppnNominal: number; total: number } {
  const pct = Math.min(100, Math.max(0, discountPercent || 0));
  const discountNominal = Math.round(subtotal * pct) / 100;
  const dpp = Math.round((subtotal - discountNominal) * 100) / 100;
  const ppnNominal = usePpn ? Math.round(dpp * ppnPersen) / 100 : 0;
  const total = Math.round((dpp + ppnNominal) * 100) / 100;
  return { discountNominal, dpp, ppnNominal, total };
}

export type ApprovalStatus = "none" | "pending" | "approved" | "rejected";

/** Quotation boleh dikirim/diterima hanya bila tidak butuh approval atau sudah disetujui. */
export function canReleaseQuotation(status: ApprovalStatus): boolean {
  return status === "none" || status === "approved";
}
