/**
 * Modul BERSAMA aturan collectibles (EPIC-014 Task 2/4).
 *
 * Keputusan skema owner: tabel terpisah per jenis aset (avatar/wallpaper/
 * badge) — yang boleh terduplikasi hanya tabel dan CRUD-nya. Aturan unlock,
 * jatah, ambang XP, tier, stok, dan jendela waktu WAJIB berasal dari sini
 * supaya tiga salinan logika tidak menyimpang.
 *
 * Sumber XP kanonik: `pos.pos_customers.total_xp` (keputusan 25 Jul 2026;
 * `crm_member_profiles.lifetime_xp` hanya mirror internal engine).
 */
import { formatNumber } from "@/lib/format";

/** Jatah total yang pernah diperoleh member: satu tiap kelipatan interval. */
export function entitlementQuota(totalXp: number, intervalXp: number): number {
  if (!Number.isFinite(totalXp) || !Number.isFinite(intervalXp) || intervalXp <= 0) return 0;
  return Math.max(0, Math.floor(totalXp / intervalXp));
}

/**
 * Sisa jatah = kuota − terpakai, dijepit ke 0: koreksi XP turun oleh admin
 * tidak boleh membuat sisa negatif, dan artwork yang sudah dimiliki tidak
 * pernah ditarik kembali.
 */
export function remainingEntitlements(totalXp: number, intervalXp: number, used: number): number {
  const usedCount = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;
  return Math.max(0, entitlementQuota(totalXp, intervalXp) - usedCount);
}

export type CollectibleBlocker =
  | "inactive"
  | "not_started"
  | "ended"
  | "out_of_stock"
  | "below_min_xp"
  | "below_tier";

export interface CollectibleGate {
  isActive: boolean;
  /** Ambang XP artwork (NULL/undefined = tanpa ambang). */
  minLifetimeXp?: number | null;
  /** Rank tier minimal artwork & rank tier member saat ini. */
  requiredTierRank?: number | null;
  memberTierRank?: number | null;
  /** Stok: null = tak terbatas. */
  stockRemaining?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
}

/**
 * Evaluasi kelayakan satu artwork untuk satu member. Dipakai portal (tampilan
 * terkunci + alasan), redeem, dan grant admin — SATU aturan untuk semua jalur.
 */
export function evaluateCollectibleGate(
  totalXp: number,
  gate: CollectibleGate,
  now: Date = new Date()
): { allowed: boolean; blocker: CollectibleBlocker | null } {
  if (!gate.isActive) return { allowed: false, blocker: "inactive" };
  if (gate.startsAt && now < new Date(gate.startsAt)) return { allowed: false, blocker: "not_started" };
  if (gate.endsAt && now > new Date(gate.endsAt)) return { allowed: false, blocker: "ended" };
  if (gate.stockRemaining != null && gate.stockRemaining <= 0) {
    return { allowed: false, blocker: "out_of_stock" };
  }
  const minXp = gate.minLifetimeXp ?? 0;
  if (totalXp < minXp) return { allowed: false, blocker: "below_min_xp" };
  if (
    gate.requiredTierRank != null &&
    (gate.memberTierRank == null || gate.memberTierRank < gate.requiredTierRank)
  ) {
    return { allowed: false, blocker: "below_tier" };
  }
  return { allowed: true, blocker: null };
}

/** Kalimat alasan terkunci yang ramah member (dipakai portal & pesan error). */
export function blockerMessage(
  blocker: CollectibleBlocker,
  ctx: { totalXp: number; minXp?: number | null; tierName?: string | null }
): string {
  switch (blocker) {
    case "inactive":
      return "Belum tersedia";
    case "not_started":
      return "Belum dirilis";
    case "ended":
      return "Periode sudah berakhir";
    case "out_of_stock":
      return "Stok habis";
    case "below_min_xp": {
      const kurang = Math.max(0, (ctx.minXp ?? 0) - ctx.totalXp);
      return `Kurang ${formatNumber(kurang)} XP lagi`;
    }
    case "below_tier":
      return ctx.tierName ? `Perlu tier ${ctx.tierName}` : "Tier belum cukup";
  }
}

export const DEFAULT_COLLECTIBLE_INTERVAL_XP = 5000;

/** Nilai interval dari crm_settings (string) → angka aman. */
export function parseIntervalXp(raw: unknown): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_COLLECTIBLE_INTERVAL_XP;
}
