import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, withTransaction } from "@/lib/db";
import { isValidCalendarDate } from "@/lib/ticketing/pricing";
import { requirePromoContext } from "@/lib/promo/server";
import { campaignTargetFields } from "@/lib/promo/campaign-schema";

// EPIC-032 A3 — daftar + buat campaign promo. Pengelola: super_admin +
// marketing (role marketing efektif setelah Task A4).

interface CampaignListRow {
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

export async function GET() {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;

  try {
    const rows = await query<CampaignListRow>(
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
      [ctx.branchId, ctx.companyId]
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[promo] list campaigns error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat campaign promo" },
      { status: 500 }
    );
  }
}

const dateField = z
  .string()
  .refine(isValidCalendarDate, "Tanggal tidak valid")
  .nullable()
  .optional();

const createSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    discount_type: z.enum(["percent", "fixed"]),
    value: z.number().positive().max(1_000_000_000),
    max_discount: z.number().positive().max(1_000_000_000).nullable().optional(),
    min_purchase: z.number().min(0).max(1_000_000_000).default(0),
    valid_from: dateField,
    valid_until: dateField,
    usage_limit: z.number().int().positive().max(1_000_000).nullable().optional(),
    per_phone_limit: z.number().int().positive().max(100).nullable().default(1),
    scope: z
      .enum(["ticketing_online", "ticketing_loket", "pos", "semua"])
      .default("ticketing_online"),
    ...campaignTargetFields,
    // Opsional: langsung buat SATU kode publik utk campaign ini
    public_code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{3,40}$/, "Kode: huruf/angka/strip, 3-40 karakter")
      .optional(),
  })
  .refine((b) => b.discount_type !== "percent" || b.value <= 100, {
    message: "Diskon persen maksimal 100",
    path: ["value"],
  })
  .refine(
    (b) => !b.valid_from || !b.valid_until || b.valid_until >= b.valid_from,
    { message: "Tanggal akhir sebelum tanggal mulai", path: ["valid_until"] }
  );

export async function POST(request: NextRequest) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;

  try {
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const result = await withTransaction(async (client) => {
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
          `INSERT INTO promo.promo_codes
             (company_id, branch_id, campaign_id, code)
           VALUES ($1, $2, $3, $4)`,
          [ctx.companyId, ctx.branchId, campaignId, body.public_code.toUpperCase()]
        );
      }
      return campaignId;
    });
    return successResponse({ id: result }, "Campaign promo dibuat");
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { success: false, error: "Kode sudah dipakai campaign lain — pilih kode lain" },
        { status: 409 }
      );
    }
    console.error("[promo] create campaign error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal membuat campaign promo" },
      { status: 500 }
    );
  }
}
