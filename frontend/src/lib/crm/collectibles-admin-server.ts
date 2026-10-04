import "server-only";
/**
 * Katalog collectible di dashboard (EPIC-014): wallpaper (Task 5), badge
 * builder (Task 6), dan laporan jatah menganggur (Task 2).
 */
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { getPool } from "@/lib/db";
import { BADGE_METRICS } from "./badges";
import { parseIntervalXp } from "./collectibles";

const UUID = /^[0-9a-f-]{36}$/i;

/** ID katalog dari query string; 400 bila bukan UUID. */
export function catalogId(raw: string | null): string {
  const id = raw ?? "";
  if (!UUID.test(id)) throw ApiError.badRequest("ID tidak valid");
  return id;
}

/** Simpan baris katalog: UPDATE bila `id` diisi (404 bila tidak ada), selain itu INSERT. */
async function upsertCatalogRow(
  id: string | null | undefined,
  sql: { update: string; insert: string },
  params: unknown[],
  notFound: string
) {
  const { rows } = id
    ? await getPool().query(sql.update, [...params, id])
    : await getPool().query(sql.insert, params);
  if (!rows[0]) throw ApiError.notFound(notFound);
  return rows[0];
}

/**
 * Hapus baris katalog; bila sudah dimiliki member cukup dinonaktifkan supaya
 * koleksi/pencapaian member tidak ditarik. Mengembalikan pesan untuk kasus itu.
 */
async function deleteOrDeactivate(
  id: string,
  sql: { owned: string; deactivate: string; remove: string },
  deactivatedMessage: string
): Promise<string | null> {
  const pool = getPool();
  const owned = await pool.query(sql.owned, [id]);
  if (owned.rows[0]) {
    await pool.query(sql.deactivate, [id]);
    return deactivatedMessage;
  }
  await pool.query(sql.remove, [id]);
  return null;
}

// ── Wallpaper ──────────────────────────────────────────────────────────────

export const wallpaperSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  code: z.string().min(2).max(60),
  name: z.string().min(2).max(120),
  rarity: z.enum(["common", "rare", "epic", "legendary", "limited"]).default("common"),
  image_url: z.string().min(1).max(500),
  thumbnail_url: z.string().max(500).optional().nullable(),
  min_lifetime_xp: z.number().int().min(0).optional().nullable(),
  required_tier_id: z.string().uuid().optional().nullable(),
  stock_total: z.number().int().min(1).optional().nullable(),
  is_active: z.boolean().default(true),
  starts_at: z.string().optional().nullable(),
  ends_at: z.string().optional().nullable(),
});

export async function listWallpapers() {
  const { rows } = await getPool().query(
    `SELECT w.*, t.name AS required_tier_name
       FROM crm.crm_collectible_wallpapers w
       LEFT JOIN crm.crm_membership_tiers t ON t.id = w.required_tier_id
      ORDER BY w.created_at DESC`
  );
  return rows;
}

export function saveWallpaper(p: z.infer<typeof wallpaperSchema>) {
  return upsertCatalogRow(
    p.id,
    {
      update: `UPDATE crm.crm_collectible_wallpapers
                  SET code=$1,name=$2,rarity=$3,image_url=$4,thumbnail_url=$5,
                      min_lifetime_xp=$6,required_tier_id=$7,stock_total=$8,
                      is_active=$9,starts_at=$10,ends_at=$11,updated_at=now()
                WHERE id=$12 RETURNING *`,
      insert: `INSERT INTO crm.crm_collectible_wallpapers
                 (code,name,rarity,image_url,thumbnail_url,min_lifetime_xp,
                  required_tier_id,stock_total,is_active,starts_at,ends_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    },
    [
      p.code, p.name, p.rarity, p.image_url, p.thumbnail_url ?? null, p.min_lifetime_xp ?? null,
      p.required_tier_id ?? null, p.stock_total ?? null, p.is_active, p.starts_at ?? null, p.ends_at ?? null,
    ],
    "Wallpaper tidak ditemukan"
  );
}

export function deleteWallpaper(id: string) {
  return deleteOrDeactivate(
    id,
    {
      owned: `SELECT 1 FROM crm.crm_member_wallpaper_inventory WHERE wallpaper_id = $1 LIMIT 1`,
      deactivate: `UPDATE crm.crm_collectible_wallpapers SET is_active=false WHERE id=$1`,
      remove: `DELETE FROM crm.crm_collectible_wallpapers WHERE id=$1`,
    },
    "Sudah dimiliki member — dinonaktifkan, bukan dihapus"
  );
}

// ── Badge ──────────────────────────────────────────────────────────────────

/** Metrik lifetime_xp memakai min_lifetime_xp; metrik lain memakai threshold. */
export const badgeSchema = z
  .object({
    id: z.string().uuid().optional().nullable(),
    code: z.string().min(2).max(60),
    name: z.string().min(2).max(120),
    image_url: z.string().max(500).optional().nullable(),
    metric: z.enum(BADGE_METRICS).default("lifetime_xp"),
    min_lifetime_xp: z.number().int().min(0).default(0),
    threshold: z.number().positive().max(1_000_000_000).nullable().optional(),
    bonus_xp: z.number().int().min(0).max(100_000).default(0),
    is_active: z.boolean().default(true),
  })
  .refine((b) => b.metric === "lifetime_xp" || b.metric === "manual" || (b.threshold ?? 0) > 0, {
    message: "Ambang wajib diisi untuk metrik ini",
  });

export async function listBadges() {
  const { rows } = await getPool().query(
    `SELECT b.*, (SELECT count(*)::int FROM crm.crm_member_badges mb WHERE mb.badge_id = b.id) AS awarded_count
       FROM crm.crm_badges b ORDER BY b.metric, COALESCE(b.threshold, b.min_lifetime_xp)`
  );
  return rows;
}

export function saveBadge(p: z.infer<typeof badgeSchema>) {
  const usesXp = p.metric === "lifetime_xp";
  return upsertCatalogRow(
    p.id,
    {
      update: `UPDATE crm.crm_badges SET code=$1,name=$2,image_url=$3,min_lifetime_xp=$4,is_active=$5,
                      metric=$6,threshold=$7,bonus_xp=$8
                WHERE id=$9 RETURNING *`,
      insert: `INSERT INTO crm.crm_badges (code,name,image_url,min_lifetime_xp,is_active,metric,threshold,bonus_xp)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    },
    [
      p.code, p.name, p.image_url ?? null, usesXp ? p.min_lifetime_xp : 0, p.is_active, p.metric,
      usesXp || p.metric === "manual" ? null : p.threshold, p.bonus_xp,
    ],
    "Badge tidak ditemukan"
  );
}

/** Badge yang sudah diraih member = bukti pencapaian; dinonaktifkan, tidak dihapus. */
export function deleteBadge(id: string) {
  return deleteOrDeactivate(
    id,
    {
      owned: `SELECT 1 FROM crm.crm_member_badges WHERE badge_id=$1 LIMIT 1`,
      deactivate: `UPDATE crm.crm_badges SET is_active=false WHERE id=$1`,
      remove: `DELETE FROM crm.crm_badges WHERE id=$1`,
    },
    "Sudah diraih member — dinonaktifkan, bukan dihapus"
  );
}

// ── Laporan jatah menganggur ───────────────────────────────────────────────

/**
 * Jatah tidak pernah berhenti bertambah, jadi katalog artwork harus terus
 * diisi. Laporan ini menunjukkan member dengan jatah belum terpakai supaya
 * kebutuhan artwork baru terlihat SEBELUM jadi keluhan member veteran.
 */
export async function loadIdleEntitlementReport() {
  const pool = getPool();
  const settingRes = await pool.query(
    `SELECT value FROM crm.crm_settings WHERE key = 'collectible_interval_xp'`
  );
  const intervalXp = parseIntervalXp(settingRes.rows[0]?.value);

  // Sisa jatah dihitung di SQL dengan rumus yang sama dengan modul bersama:
  // greatest(0, floor(total_xp / interval) - terpakai).
  const { rows } = await pool.query<{ idle: number }>(
    `SELECT c.id AS customer_id, c.name, c.phone, c.total_xp::int AS total_xp,
            floor(c.total_xp / $1)::int AS quota,
            COALESCE(e.used, 0)::int AS used,
            greatest(0, floor(c.total_xp / $1)::int - COALESCE(e.used, 0))::int AS idle
       FROM pos.pos_customers c
       LEFT JOIN (
         SELECT customer_id, count(*)::int AS used
           FROM crm.crm_member_entitlements
          GROUP BY customer_id
       ) e ON e.customer_id = c.id
      WHERE c.total_xp >= $1
      ORDER BY greatest(0, floor(c.total_xp / $1)::int - COALESCE(e.used, 0)) DESC, c.total_xp DESC
      LIMIT 100`,
    [intervalXp]
  );

  const catalogRes = await pool.query(
    `SELECT count(*)::int AS aktif FROM crm.crm_collectible_avatars
      WHERE is_active AND (ends_at IS NULL OR ends_at >= now())`
  );

  return {
    interval_xp: intervalXp,
    total_idle: rows.reduce((sum, r) => sum + Number(r.idle), 0),
    active_artworks: Number(catalogRes.rows[0]?.aktif ?? 0),
    members: rows,
  };
}
