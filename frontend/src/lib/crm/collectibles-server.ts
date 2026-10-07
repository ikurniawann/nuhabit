import "server-only";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "@/lib/db";
import { createPgClient } from "@/lib/pg/create-client";
import { awardBadgeBonusXp } from "./loyalty-engine";
import { getCrmDefaultVenue } from "./server";
import { isBadgeEarned, longestWeeklyStreak, type BadgeRule, type MemberBadgeStats } from "./badges";
import {
  blockerMessage,
  entitlementQuota,
  evaluateCollectibleGate,
  parseIntervalXp,
  remainingEntitlements,
} from "./collectibles";

/**
 * EPIC-014 — logika koleksi (artwork) member.
 *
 * Modul ini sengaja menjadi SATU-SATUNYA tempat aturan koleksi tinggal.
 * Skema memakai tabel terpisah per jenis aset (avatar, nanti wallpaper dan
 * badge), jadi yang boleh terduplikasi hanya tabel dan CRUD-nya — bukan
 * aturan kelayakan, kepemilikan, maupun stok. Tanpa disiplin ini ketiganya
 * akan menyimpang satu sama lain.
 *
 * Sumber XP: `pos.pos_customers.total_xp`, mengikuti modul reward dan angka
 * yang sudah ditampilkan portal. Kolom `crm.crm_member_profiles.lifetime_xp`
 * TIDAK dipakai karena kedua nilai itu terbukti bisa menyimpang.
 *
 * Fase ini belum menukar apa pun: XP hanya menentukan kelayakan, dan tidak
 * pernah berkurang.
 */

export type Rarity = "common" | "rare" | "epic" | "legendary" | "limited";

/** Urutan tampil — yang paling langka tampil lebih dulu. */
const RARITY_RANK: Record<Rarity, number> = {
  limited: 0,
  legendary: 1,
  epic: 2,
  rare: 3,
  common: 4,
};

export const RARITY_LABELS: Record<Rarity, string> = {
  limited: "Terbatas",
  legendary: "Legendaris",
  epic: "Epik",
  rare: "Langka",
  common: "Umum",
};

export type MemberCollectible = {
  id: string;
  code: string;
  name: string;
  rarity: Rarity;
  image_url: string;
  thumbnail_url: string | null;
  required_tier_name: string | null;
  /** Sisa stok; null berarti tak terbatas. */
  remaining_stock: number | null;
  owned: boolean;
  equipped: boolean;
  acquired_at: string | null;
  /** Alasan terkunci untuk ditampilkan apa adanya ke member. */
  locked_reason: string | null;
  /** Kekurangan XP menuju syarat; 0 bila syarat sudah terpenuhi. */
  xp_needed: number;
};

type CatalogRow = {
  id: string;
  code: string;
  name: string;
  rarity: string;
  image_url: string;
  thumbnail_url: string | null;
  required_tier_name: string | null;
  required_tier_min_xp: number | null;
  min_lifetime_xp: number | null;
  stock_total: number | null;
  stock_redeemed: number | null;
  is_active: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
  inventory_id: string | null;
  is_equipped: boolean | null;
  acquired_at: Date | null;
};

function normalizeRarity(value: string | null): Rarity {
  return value != null && value in RARITY_RANK ? (value as Rarity) : "common";
}

function toIso(value: Date | null): string | null {
  return value == null ? null : new Date(value).toISOString();
}

/**
 * Katalog dari sudut pandang satu member.
 *
 * Artwork yang SUDAH dimiliki selalu ikut tampil walau sudah tidak aktif atau
 * jendela waktunya lewat — koleksi yang sudah didapat tidak boleh hilang dari
 * mata pemiliknya.
 */
export async function listCollectiblesForMember(
  db: Pool | PoolClient,
  memberProfileId: string | null
): Promise<CatalogRow[]> {
  const { rows } = await db.query(
    `SELECT a.id, a.code, a.name, a.rarity, a.image_url, a.thumbnail_url,
            a.stock_total, a.stock_redeemed, a.is_active, a.starts_at, a.ends_at,
            a.min_lifetime_xp::int AS min_lifetime_xp,
            t.name AS required_tier_name,
            t.min_lifetime_xp::int AS required_tier_min_xp,
            inv.id AS inventory_id, inv.is_equipped, inv.acquired_at
       FROM crm.crm_collectible_avatars a
       LEFT JOIN crm.crm_membership_tiers t ON t.id = a.required_tier_id
       LEFT JOIN crm.crm_member_avatar_inventory inv
              ON inv.avatar_id = a.id AND inv.member_id = $1
      WHERE inv.id IS NOT NULL
         OR (a.is_active
             AND (a.starts_at IS NULL OR a.starts_at <= now())
             AND (a.ends_at IS NULL OR a.ends_at >= now()))`,
    [memberProfileId]
  );

  return rows as CatalogRow[];
}

/**
 * Kelayakan satu artwork bagi member.
 *
 * Fase ini hanya menjelaskan syarat kepada member; penukaran belum ada.
 * Stok habis tetap dilaporkan agar member tidak mengejar sesuatu yang mustahil.
 */
export function evaluateCollectible(row: CatalogRow, totalXp: number): MemberCollectible {
  const owned = row.inventory_id != null;
  const stockTotal = row.stock_total == null ? null : Number(row.stock_total);
  const stockRedeemed = Number(row.stock_redeemed ?? 0);
  const remainingStock = stockTotal == null ? null : Math.max(0, stockTotal - stockRedeemed);
  // Syarat efektif = ambang tier ATAU ambang artwork (Task 2), yang tertinggi.
  const tierXp = row.required_tier_min_xp == null ? 0 : Number(row.required_tier_min_xp);
  const artXp = row.min_lifetime_xp == null ? 0 : Number(row.min_lifetime_xp);
  const requiredXp = Math.max(tierXp, artXp);
  const xpNeeded = Math.max(0, requiredXp - totalXp);

  // Aturan unlock dari modul bersama (Task 4) — jangan menyalin logikanya.
  let lockedReason: string | null = null;
  if (!owned) {
    const gate = evaluateCollectibleGate(totalXp, {
      isActive: true, // baris tak aktif/di luar jendela sudah tersaring query
      minLifetimeXp: requiredXp,
      stockRemaining: remainingStock,
    });
    if (!gate.allowed && gate.blocker) {
      // Ambang yang menghalangi berasal dari tier → sebut nama tiernya.
      lockedReason =
        gate.blocker === "below_min_xp" && tierXp >= artXp && row.required_tier_name
          ? `Perlu tier ${row.required_tier_name}`
          : blockerMessage(gate.blocker, { totalXp, minXp: requiredXp, tierName: row.required_tier_name });
    } else {
      lockedReason = "Belum kamu miliki";
    }
  }

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    rarity: normalizeRarity(row.rarity),
    image_url: row.image_url,
    thumbnail_url: row.thumbnail_url,
    required_tier_name: row.required_tier_name,
    remaining_stock: remainingStock,
    owned,
    equipped: row.is_equipped === true,
    acquired_at: toIso(row.acquired_at),
    locked_reason: lockedReason,
    xp_needed: xpNeeded,
  };
}

export interface EntitlementSummary {
  interval_xp: number;
  quota: number;
  used: number;
  remaining: number;
}

/**
 * Ringkasan jatah tukar member (EPIC-014 Task 2). Dihitung saat dibaca —
 * tanpa backfill: `floor(total_xp / interval) − terpakai`, dijepit ke 0.
 */
export async function getEntitlementSummary(
  db: Pool | PoolClient,
  customerId: string,
  totalXp: number
): Promise<EntitlementSummary> {
  const [settingRes, usedRes] = await Promise.all([
    db.query(`SELECT value FROM crm.crm_settings WHERE key = 'collectible_interval_xp'`),
    db.query(`SELECT count(*)::int AS used FROM crm.crm_member_entitlements WHERE customer_id = $1`, [
      customerId,
    ]),
  ]);
  const intervalXp = parseIntervalXp(settingRes.rows[0]?.value);
  const used = Number(usedRes.rows[0]?.used ?? 0);
  return {
    interval_xp: intervalXp,
    quota: entitlementQuota(totalXp, intervalXp),
    used,
    remaining: remainingEntitlements(totalXp, intervalXp, used),
  };
}

/**
 * Kelayakan grant/redeem satu avatar untuk satu customer — dipakai jalur
 * admin grant (dan redeem member di Task 3) supaya `required_tier_id` +
 * `min_lifetime_xp` ditegakkan di SEMUA jalur perolehan, bukan hanya portal.
 */
export async function checkAvatarEligibility(
  db: Pool | PoolClient,
  avatarId: string,
  customerId: string
): Promise<{ allowed: boolean; reason: string | null }> {
  const { rows } = await db.query(
    `SELECT a.is_active, a.starts_at, a.ends_at, a.stock_total, a.stock_redeemed,
            a.min_lifetime_xp::int AS min_lifetime_xp,
            t.name AS required_tier_name,
            t.min_lifetime_xp::int AS required_tier_min_xp,
            c.total_xp::int AS total_xp
       FROM crm.crm_collectible_avatars a
       LEFT JOIN crm.crm_membership_tiers t ON t.id = a.required_tier_id
       CROSS JOIN pos.pos_customers c
      WHERE a.id = $1 AND c.id = $2`,
    [avatarId, customerId]
  );
  const row = rows[0] as
    | {
        is_active: boolean;
        starts_at: Date | null;
        ends_at: Date | null;
        stock_total: number | null;
        stock_redeemed: number | null;
        min_lifetime_xp: number | null;
        required_tier_name: string | null;
        required_tier_min_xp: number | null;
        total_xp: number;
      }
    | undefined;
  if (!row) return { allowed: false, reason: "Artwork atau member tidak ditemukan" };

  const totalXp = Number(row.total_xp ?? 0);
  const requiredXp = Math.max(Number(row.required_tier_min_xp ?? 0), Number(row.min_lifetime_xp ?? 0));
  const stockTotal = row.stock_total == null ? null : Number(row.stock_total);
  const gate = evaluateCollectibleGate(totalXp, {
    isActive: row.is_active,
    minLifetimeXp: requiredXp,
    stockRemaining: stockTotal == null ? null : Math.max(0, stockTotal - Number(row.stock_redeemed ?? 0)),
    startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : null,
    endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null,
  });
  if (gate.allowed || !gate.blocker) return { allowed: true, reason: null };
  return {
    allowed: false,
    reason: blockerMessage(gate.blocker, {
      totalXp,
      minXp: requiredXp,
      tierName: row.required_tier_name,
    }),
  };
}

/**
 * Katalog wallpaper dari sudut pandang member (Task 5) — bentuk baris sama
 * dengan avatar sehingga `evaluateCollectible` dipakai apa adanya.
 */
export async function listWallpapersForMember(
  db: Pool | PoolClient,
  memberProfileId: string | null
): Promise<CatalogRow[]> {
  const { rows } = await db.query(
    `SELECT w.id, w.code, w.name, w.rarity, w.image_url, w.thumbnail_url,
            w.stock_total, w.stock_redeemed, w.is_active, w.starts_at, w.ends_at,
            w.min_lifetime_xp::int AS min_lifetime_xp,
            t.name AS required_tier_name,
            t.min_lifetime_xp::int AS required_tier_min_xp,
            inv.id AS inventory_id, NULL::boolean AS is_equipped, inv.acquired_at
       FROM crm.crm_collectible_wallpapers w
       LEFT JOIN crm.crm_membership_tiers t ON t.id = w.required_tier_id
       LEFT JOIN crm.crm_member_wallpaper_inventory inv
              ON inv.wallpaper_id = w.id AND inv.member_id = $1
      WHERE inv.id IS NOT NULL
         OR (w.is_active
             AND (w.starts_at IS NULL OR w.starts_at <= now())
             AND (w.ends_at IS NULL OR w.ends_at >= now()))`,
    [memberProfileId]
  );
  return rows as CatalogRow[];
}

/** Kelayakan wallpaper — aturan sama persis dengan avatar (modul bersama). */
export async function checkWallpaperEligibility(
  db: Pool | PoolClient,
  wallpaperId: string,
  customerId: string
): Promise<{ allowed: boolean; reason: string | null }> {
  const { rows } = await db.query(
    `SELECT w.is_active, w.starts_at, w.ends_at, w.stock_total, w.stock_redeemed,
            w.min_lifetime_xp::int AS min_lifetime_xp,
            t.name AS required_tier_name,
            t.min_lifetime_xp::int AS required_tier_min_xp,
            c.total_xp::int AS total_xp
       FROM crm.crm_collectible_wallpapers w
       LEFT JOIN crm.crm_membership_tiers t ON t.id = w.required_tier_id
       CROSS JOIN pos.pos_customers c
      WHERE w.id = $1 AND c.id = $2`,
    [wallpaperId, customerId]
  );
  const row = rows[0];
  if (!row) return { allowed: false, reason: "Wallpaper atau member tidak ditemukan" };
  const totalXp = Number(row.total_xp ?? 0);
  const requiredXp = Math.max(Number(row.required_tier_min_xp ?? 0), Number(row.min_lifetime_xp ?? 0));
  const stockTotal = row.stock_total == null ? null : Number(row.stock_total);
  const gate = evaluateCollectibleGate(totalXp, {
    isActive: Boolean(row.is_active),
    minLifetimeXp: requiredXp,
    stockRemaining: stockTotal == null ? null : Math.max(0, stockTotal - Number(row.stock_redeemed ?? 0)),
    startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : null,
    endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null,
  });
  if (gate.allowed || !gate.blocker) return { allowed: true, reason: null };
  return {
    allowed: false,
    reason: blockerMessage(gate.blocker, { totalXp, minXp: requiredXp, tierName: row.required_tier_name }),
  };
}

export interface AwardedBadge {
  badge_id: string;
  code: string;
  name: string;
}

type BadgeCandidate = BadgeRule & { id: string; code: string; name: string; bonus_xp: number };

/** Statistik order lunas member untuk badge non-XP (kunjungan per hari WIB). */
async function loadOrderBadgeStats(
  db: Pool | PoolClient,
  customerId: string
): Promise<Omit<MemberBadgeStats, "lifetimeXp">> {
  const { rows } = await db.query(
    `SELECT count(DISTINCT (o.created_at AT TIME ZONE 'Asia/Jakarta')::date)::int AS visits,
            COALESCE(sum(o.total_amount), 0)::float AS spend,
            COALESCE(array_agg(DISTINCT date_trunc('week', o.created_at AT TIME ZONE 'Asia/Jakarta')::date::text)
                     FILTER (WHERE o.id IS NOT NULL), '{}') AS weeks
       FROM pos.pos_orders o
      WHERE o.customer_id = $1 AND o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'voided', 'merged')`,
    [customerId]
  );
  const row = rows[0] ?? {};
  return {
    visits: Number(row.visits ?? 0),
    spendIdr: Number(row.spend ?? 0),
    streakWeeks: longestWeeklyStreak((row.weeks as string[] | null) ?? []),
  };
}

/** Bonus XP badge lewat ledger (idempoten per badge per member). */
async function grantBadgeBonuses(customerId: string, badges: Array<{ id: string; name: string; bonus_xp: number }>) {
  const withBonus = badges.filter((b) => Number(b.bonus_xp) > 0);
  if (withBonus.length === 0) return;
  const db = createPgClient();
  const venue = await getCrmDefaultVenue(db);
  for (const badge of withBonus) {
    await awardBadgeBonusXp(db, {
      customerId,
      badgeId: badge.id,
      badgeName: badge.name,
      xpAmount: Number(badge.bonus_xp),
      companyId: venue.companyId,
      branchId: venue.branchId,
    });
  }
}

/**
 * Badge per metrik: berikan semua badge aktif yang syaratnya terpenuhi tapi
 * belum dimiliki dan tidak pernah dicabut admin. Idempoten lewat UNIQUE
 * (customer, badge) + ON CONFLICT DO NOTHING; dipanggil lazily saat portal
 * dibaca. Statistik order hanya dihitung bila ada kandidat non-XP.
 */
export async function awardEligibleBadges(
  db: Pool | PoolClient,
  customerId: string,
  memberProfileId: string | null,
  totalXp: number
): Promise<AwardedBadge[]> {
  const { rows: candidates } = await db.query<BadgeCandidate>(
    `SELECT b.id, b.code, b.name, b.metric, b.threshold, b.min_lifetime_xp, b.bonus_xp
       FROM crm.crm_badges b
      WHERE b.is_active AND b.metric <> 'manual'
        AND NOT EXISTS (SELECT 1 FROM crm.crm_member_badges mb
                         WHERE mb.customer_id = $1 AND mb.badge_id = b.id)
        AND NOT EXISTS (SELECT 1 FROM crm.crm_member_badge_revocations rv
                         WHERE rv.customer_id = $1 AND rv.badge_id = b.id)`,
    [customerId]
  );
  if (candidates.length === 0) return [];

  const needsOrders = candidates.some((b) => b.metric !== "lifetime_xp");
  const stats: MemberBadgeStats = {
    lifetimeXp: totalXp,
    ...(needsOrders ? await loadOrderBadgeStats(db, customerId) : { visits: 0, spendIdr: 0, streakWeeks: 0 }),
  };
  const earned = candidates.filter((b) => isBadgeEarned(b, stats));
  if (earned.length === 0) return [];

  const { rows } = await db.query<{ badge_id: string }>(
    `INSERT INTO crm.crm_member_badges (customer_id, member_id, badge_id)
     SELECT $1, $2, unnest($3::uuid[])
     ON CONFLICT (customer_id, badge_id) DO NOTHING
     RETURNING badge_id`,
    [customerId, memberProfileId, earned.map((b) => b.id)]
  );
  const inserted = new Set(rows.map((r) => r.badge_id));
  const awarded = earned.filter((b) => inserted.has(b.id));
  await grantBadgeBonuses(customerId, awarded);
  return awarded.map((b) => ({ badge_id: b.id, code: b.code, name: b.name }));
}

/**
 * Admin memberi badge apa pun (termasuk metrik manual). Mencabut catatan
 * pencabutan sebelumnya; bonus XP tetap sekali seumur hidup per badge.
 */
export async function awardBadgeManually(input: {
  customerId: string;
  badgeId: string;
  actorId: string;
}): Promise<{ awarded: boolean }> {
  const badge = await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; name: string; bonus_xp: number }>(
      `SELECT id, name, bonus_xp FROM crm.crm_badges WHERE id = $1`,
      [input.badgeId]
    );
    if (!rows[0]) return null;
    await client.query(
      `DELETE FROM crm.crm_member_badge_revocations WHERE customer_id = $1 AND badge_id = $2`,
      [input.customerId, input.badgeId]
    );
    const inserted = await client.query(
      `INSERT INTO crm.crm_member_badges (customer_id, member_id, badge_id, source, awarded_by)
       SELECT $1, (SELECT id FROM crm.crm_member_profiles WHERE customer_id = $1), $2, 'manual', $3
       ON CONFLICT (customer_id, badge_id) DO NOTHING`,
      [input.customerId, input.badgeId, input.actorId]
    );
    return (inserted.rowCount ?? 0) > 0 ? rows[0] : null;
  });
  if (badge) await grantBadgeBonuses(input.customerId, [badge]);
  return { awarded: badge !== null };
}

/**
 * Admin mencabut badge. Catatan pencabutan mencegah evaluasi otomatis
 * memberikannya lagi; bonus XP yang sudah masuk tidak ditarik.
 */
export function revokeBadge(input: {
  customerId: string;
  badgeId: string;
  actorId: string;
  reason: string | null;
}): Promise<{ revoked: boolean }> {
  return withTransaction(async (client) => {
    const removed = await client.query(
      `DELETE FROM crm.crm_member_badges WHERE customer_id = $1 AND badge_id = $2`,
      [input.customerId, input.badgeId]
    );
    await client.query(
      `INSERT INTO crm.crm_member_badge_revocations (customer_id, badge_id, reason, revoked_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (customer_id, badge_id)
       DO UPDATE SET reason = EXCLUDED.reason, revoked_by = EXCLUDED.revoked_by, revoked_at = now()`,
      [input.customerId, input.badgeId, input.reason, input.actorId]
    );
    return { revoked: (removed.rowCount ?? 0) > 0 };
  });
}

/** Dimiliki lebih dulu, lalu yang paling langka, lalu abjad. */
export function sortCollectibles(items: MemberCollectible[]): MemberCollectible[] {
  return [...items].sort((a, b) => {
    if (a.owned !== b.owned) return a.owned ? -1 : 1;
    const rarityGap = RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity];
    if (rarityGap !== 0) return rarityGap;
    return a.name.localeCompare(b.name, "id");
  });
}

export type EquipResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Pasang artwork sebagai avatar aktif.
 *
 * Dibungkus transaksi karena menyentuh dua tabel: penanda `is_equipped` di
 * inventory dan `active_avatar_id` di profil. Bila salah satu gagal, keduanya
 * harus batal agar tidak ada avatar terpasang yang tidak tercatat.
 */
export async function equipCollectible(
  pool: Pool,
  params: { memberProfileId: string; avatarId: string }
): Promise<EquipResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT id FROM crm.crm_member_avatar_inventory
        WHERE member_id = $1 AND avatar_id = $2
        FOR UPDATE`,
      [params.memberProfileId, params.avatarId]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, status: 403, error: "Artwork ini belum kamu miliki" };
    }

    await client.query(
      `UPDATE crm.crm_member_avatar_inventory
          SET is_equipped = (avatar_id = $2)
        WHERE member_id = $1`,
      [params.memberProfileId, params.avatarId]
    );

    await client.query(
      `UPDATE crm.crm_member_profiles
          SET active_avatar_id = $2, last_activity_at = now()
        WHERE id = $1`,
      [params.memberProfileId, params.avatarId]
    );

    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
