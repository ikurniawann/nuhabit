import { z } from "zod";
import { getPool } from "@/lib/db";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";
import {
  cleanReviewText,
  REVIEW_COMMENT_MAX,
  REVIEW_INELIGIBLE_MESSAGES,
  REVIEW_WINDOW_DAYS,
  reviewEligibility,
} from "@/lib/crm/member-reviews";

/** Waktu order dianggap lunas/selesai — acuan jendela 14 hari. */
const PAID_AT = "COALESCE(o.completed_at, o.ordered_at, o.created_at)";

/** GET — order lunas yang masih bisa diulas + ulasan member beserta balasannya. */
export const GET = withMemberSession("Gagal memuat ulasan", async (customerId) => {
  const pool = getPool();
  const [eligible, reviews] = await Promise.all([
    pool.query(
      `SELECT o.id, o.order_number, o.total_amount::float AS total_amount, ${PAID_AT} AS paid_at,
              b.name AS outlet_name,
              ${PAID_AT} + make_interval(days => $2) AS review_until
         FROM pos.pos_orders o
         LEFT JOIN configuration.branches b ON b.id = o.branch_id
        WHERE o.customer_id = $1 AND o.payment_status = 'paid'
          AND o.status NOT IN ('cancelled', 'voided', 'merged')
          AND ${PAID_AT} >= now() - make_interval(days => $2)
          AND NOT EXISTS (SELECT 1 FROM crm.member_reviews r WHERE r.order_id = o.id)
        ORDER BY ${PAID_AT} DESC
        LIMIT 20`,
      [customerId, REVIEW_WINDOW_DAYS]
    ),
    pool.query(
      `SELECT r.id, r.order_id, o.order_number, b.name AS outlet_name, r.rating, r.comment,
              r.reply, r.replied_at, r.created_at
         FROM crm.member_reviews r
         JOIN pos.pos_orders o ON o.id = r.order_id
         LEFT JOIN configuration.branches b ON b.id = r.branch_id
        WHERE r.customer_id = $1
        ORDER BY r.created_at DESC
        LIMIT 30`,
      [customerId]
    ),
  ]);
  return memberJson({ eligible: eligible.rows, reviews: reviews.rows });
});

const reviewSchema = z.object({
  order_id: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(REVIEW_COMMENT_MAX * 2).nullable().optional(),
});

/** POST — beri ulasan 1–5 bintang (+ komentar opsional) untuk satu order lunas. */
export const POST = withMemberSession("Gagal menyimpan ulasan", async (customerId, request: Request) => {
  const parsed = reviewSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return memberError("Pilih 1 sampai 5 bintang");
  const { order_id, rating, comment } = parsed.data;

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT o.customer_id, o.payment_status::text AS payment_status, o.status::text AS status,
            o.branch_id, ${PAID_AT} AS paid_at,
            EXISTS (SELECT 1 FROM crm.member_reviews r WHERE r.order_id = o.id) AS reviewed
       FROM pos.pos_orders o WHERE o.id = $1`,
    [order_id]
  );
  const order = rows[0] ?? null;
  const check = reviewEligibility(order, {
    customerId,
    now: new Date(),
    alreadyReviewed: order?.reviewed === true,
  });
  if (!check.ok) return memberError(REVIEW_INELIGIBLE_MESSAGES[check.reason], check.reason === "sudah-diulas" ? 409 : 400);

  // UNIQUE(order_id) menjaga satu ulasan per order walau dua tap bersamaan.
  const inserted = await pool.query(
    `INSERT INTO crm.member_reviews (order_id, customer_id, branch_id, rating, comment)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (order_id) DO NOTHING
     RETURNING id, order_id, rating, comment, created_at`,
    [order_id, customerId, order.branch_id, rating, cleanReviewText(comment)]
  );
  if (!inserted.rows[0]) return memberError(REVIEW_INELIGIBLE_MESSAGES["sudah-diulas"], 409);
  return memberJson(inserted.rows[0]);
});
