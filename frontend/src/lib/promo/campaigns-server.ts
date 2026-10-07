// EPIC-032 A3 — campaign promo per venue: daftar, buat, ubah, riwayat pemakaian.
import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import type { CampaignCreateInput, CampaignPatch } from "./campaign-schema";
import { planCampaignUpdate, type CampaignSnapshot } from "./campaign-rules";
import type { PromoContext, PromoVenue } from "./server";

export interface CampaignListRow {
  id: string;
  name: string;
  description: string | null;
  discount_type: "percent" | "fixed";
  value: string;
  max_discount: string | null;
  min_purchase: string;
  valid_from: string | null;
  valid_until: string | null;
  usage_limit: number | null;
  per_phone_limit: number | null;
  scope: string;
  is_active: boolean;
  show_in_member_portal: boolean;
  target_product_ids: string[];
  target_category_ids: string[];
  eligibility: string;
  new_member_days: number | null;
  created_at: string;
  codes_count: string;
  held_count: string;
  captured_count: string;
  discount_captured: string;
}

export interface RedemptionRow {
  id: string;
  code: string;
  context_type: string;
  context_id: string;
  phone: string | null;
  discount_amount: string;
  status: "held" | "captured" | "released";
  created_at: string;
}

export const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === "23505";

export function listCampaigns(venue: PromoVenue): Promise<CampaignListRow[]> {
  return query<CampaignListRow>(
    `SELECT c.id, c.name, c.description, c.discount_type, c.value,
            c.max_discount, c.min_purchase,
            c.valid_from::text AS valid_from,
            c.valid_until::text AS valid_until,
            c.usage_limit, c.per_phone_limit, c.scope, c.is_active,
            c.show_in_member_portal,
            c.target_product_ids::text[] AS target_product_ids,
            c.target_category_ids::text[] AS target_category_ids,
            c.eligibility, c.new_member_days,
            c.created_at,
            (SELECT COUNT(*) FROM promo.promo_codes k
              WHERE k.campaign_id = c.id) AS codes_count,
            (SELECT COUNT(*) FROM promo.promo_redemptions r
              WHERE r.campaign_id = c.id AND r.status = 'held') AS held_count,
            (SELECT COUNT(*) FROM promo.promo_redemptions r
              WHERE r.campaign_id = c.id AND r.status = 'captured') AS captured_count,
            (SELECT COALESCE(SUM(r.discount_amount), 0)
              FROM promo.promo_redemptions r
              WHERE r.campaign_id = c.id AND r.status = 'captured') AS discount_captured
     FROM promo.promo_campaigns c
     WHERE c.branch_id = $1 AND c.company_id = $2
     ORDER BY c.created_at DESC`,
    [venue.branchId, venue.companyId]
  );
}

/** Buat campaign (+ satu kode publik opsional) dalam satu transaksi; mengembalikan id. */
export async function createCampaign(ctx: PromoContext, body: CampaignCreateInput): Promise<string> {
  try {
    return await withTransaction(async (client) => {
      const campaign = await client.query<{ id: string }>(
        `INSERT INTO promo.promo_campaigns
           (company_id, branch_id, name, description, discount_type, value,
            max_discount, min_purchase, valid_from, valid_until, usage_limit,
            per_phone_limit, scope, created_by, target_product_ids,
            target_category_ids, eligibility, new_member_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING id`,
        [
          ctx.companyId,
          ctx.branchId,
          body.name,
          body.description ?? null,
          body.discount_type,
          body.value,
          body.discount_type === "percent" ? (body.max_discount ?? null) : null,
          body.min_purchase,
          body.valid_from ?? null,
          body.valid_until ?? null,
          body.usage_limit ?? null,
          body.per_phone_limit,
          body.scope,
          ctx.user.id,
          body.target_product_ids ?? [],
          body.target_category_ids ?? [],
          body.eligibility ?? "semua",
          body.eligibility === "member_baru" ? (body.new_member_days ?? null) : null,
        ]
      );
      const campaignId = campaign.rows[0].id;
      if (body.public_code) {
        await client.query(
          `INSERT INTO promo.promo_codes (company_id, branch_id, campaign_id, code)
           VALUES ($1, $2, $3, $4)`,
          [ctx.companyId, ctx.branchId, campaignId, body.public_code.toUpperCase()]
        );
      }
      return campaignId;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw ApiError.conflict("Kode sudah dipakai campaign lain — pilih kode lain");
    throw err;
  }
}

/** Edit campaign. Toggle aktif selalu boleh; aturan diskon hanya selama belum ada redemption captured. */
export async function updateCampaign(venue: PromoVenue, id: string, body: CampaignPatch): Promise<void> {
  const current = await queryOne<CampaignSnapshot>(
    `SELECT c.discount_type, c.value,
            c.valid_from::text AS valid_from,
            c.valid_until::text AS valid_until,
            (SELECT COUNT(*)::text FROM promo.promo_redemptions r
              WHERE r.campaign_id = c.id AND r.status = 'captured') AS captured_count
     FROM promo.promo_campaigns c
     WHERE c.id = $1 AND c.branch_id = $2 AND c.company_id = $3`,
    [id, venue.branchId, venue.companyId]
  );
  if (!current) throw ApiError.notFound("Campaign tidak ditemukan");

  const columns = planCampaignUpdate(body, current);
  const values = columns.map(([, value]) => value);
  const sets = ["updated_at = now()", ...columns.map(([column], i) => `${column} = $${i + 1}`)];
  values.push(id, venue.branchId, venue.companyId);
  await query(
    `UPDATE promo.promo_campaigns SET ${sets.join(", ")}
     WHERE id = $${values.length - 2} AND branch_id = $${values.length - 1}
       AND company_id = $${values.length}`,
    values
  );
}

/** 404 bila campaign tidak ada di venue ini. */
export async function assertCampaign(venue: PromoVenue, id: string): Promise<void> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM promo.promo_campaigns
     WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
    [id, venue.branchId, venue.companyId]
  );
  if (!row) throw ApiError.notFound("Campaign tidak ditemukan");
}

/** 100 pemakaian terbaru satu campaign. */
export async function listRedemptions(venue: PromoVenue, id: string): Promise<RedemptionRow[]> {
  await assertCampaign(venue, id);
  return query<RedemptionRow>(
    `SELECT r.id, k.code, r.context_type, r.context_id, r.phone,
            r.discount_amount, r.status, r.created_at
     FROM promo.promo_redemptions r
     JOIN promo.promo_codes k ON k.id = r.code_id
     WHERE r.campaign_id = $1
     ORDER BY r.created_at DESC
     LIMIT 100`,
    [id]
  );
}

/** Produk & kategori POS untuk pemilih target promo/penawaran. */
export async function loadPromoCatalog() {
  const [products, categories] = await Promise.all([
    query<{ id: string; name: string; price: string; category_id: string | null }>(
      `SELECT id, name, base_price::text AS price, category_id
         FROM pos.pos_products
        WHERE is_active IS NOT FALSE
        ORDER BY name`
    ),
    query<{ id: string; name: string }>(
      `SELECT id, name FROM pos.pos_categories
        WHERE is_active IS NOT FALSE
        ORDER BY display_order NULLS LAST, name`
    ),
  ]);
  return { products, categories };
}
