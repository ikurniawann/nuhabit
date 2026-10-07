import "server-only";
/** Ulasan member (dashboard): daftar + ringkasan rating, balas, sembunyikan/tampilkan. */
import { z } from "zod";
import { getPool, withTransaction } from "@/lib/db";
import { notifyMember } from "./engagement/server";
import { cleanReviewText, REVIEW_REPLY_MAX, summarizeReviews, type RatingCountRow } from "./member-reviews";

const UUID = /^[0-9a-f-]{36}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Daftar ulasan member + ringkasan. Filter: status, rating, branch_id, q
 * (nama/telepon/komentar), from/to (YYYY-MM-DD). Ringkasan memakai filter
 * outlet/tanggal/pencarian saja supaya rata-rata tidak bergeser karena
 * filter status atau bintang.
 */
export async function listMemberReviews(sp: URLSearchParams) {
  const base: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (p: string) => string, value: unknown) => {
    params.push(value);
    base.push(clause(`$${params.length}`));
  };
  const branchId = sp.get("branch_id");
  if (branchId && UUID.test(branchId)) add((p) => `r.branch_id = ${p}`, branchId);
  const from = sp.get("from");
  if (from && ISO_DATE.test(from)) {
    add((p) => `(r.created_at AT TIME ZONE 'Asia/Jakarta')::date >= ${p}::date`, from);
  }
  const to = sp.get("to");
  if (to && ISO_DATE.test(to)) {
    add((p) => `(r.created_at AT TIME ZONE 'Asia/Jakarta')::date <= ${p}::date`, to);
  }
  const q = sp.get("q")?.trim();
  if (q) add((p) => `(c.name ILIKE ${p} OR c.phone ILIKE ${p} OR r.comment ILIKE ${p})`, `%${q}%`);

  const listWhere = [...base];
  const listParams = [...params];
  const status = sp.get("status");
  if (status && ["new", "replied", "hidden"].includes(status)) {
    listParams.push(status);
    listWhere.push(`r.status = $${listParams.length}`);
  }
  const rating = Number(sp.get("rating"));
  if (Number.isInteger(rating) && rating >= 1 && rating <= 5) {
    listParams.push(rating);
    listWhere.push(`r.rating = $${listParams.length}`);
  }
  const whereSql = (clauses: string[]) => (clauses.length ? `WHERE ${clauses.join(" AND ")}` : "");
  const fromSql = `FROM crm.member_reviews r
    JOIN pos.pos_customers c ON c.id = r.customer_id
    LEFT JOIN configuration.branches b ON b.id = r.branch_id`;

  const pool = getPool();
  const [reviews, counts, outlets] = await Promise.all([
    pool.query(
      `SELECT r.id, r.order_id, o.order_number, o.total_amount::float AS order_total,
              r.rating, r.comment, r.status, r.reply, r.replied_at, r.created_at,
              c.id AS customer_id, c.name AS member_name, c.phone AS member_phone,
              r.branch_id, b.name AS outlet_name, u.full_name AS replied_by_name
         ${fromSql}
         JOIN pos.pos_orders o ON o.id = r.order_id
         LEFT JOIN configuration.users u ON u.id = r.replied_by
         ${whereSql(listWhere)}
        ORDER BY r.created_at DESC
        LIMIT 200`,
      listParams
    ),
    pool.query<RatingCountRow>(
      `SELECT r.branch_id, b.name AS branch_name, r.rating, count(*)::int AS n
         ${fromSql}
         ${whereSql([...base, "r.status <> 'hidden'"])}
        GROUP BY r.branch_id, b.name, r.rating`,
      params
    ),
    pool.query(
      `SELECT DISTINCT b.id, b.name FROM crm.member_reviews r
         JOIN configuration.branches b ON b.id = r.branch_id ORDER BY b.name`
    ),
  ]);
  return { reviews: reviews.rows, summary: summarizeReviews(counts.rows), outlets: outlets.rows };
}

export const memberReviewPatchSchema = z.union([
  z.object({ reply: z.string().trim().min(2, "Balasan minimal 2 karakter").max(REVIEW_REPLY_MAX) }),
  z.object({ status: z.enum(["hidden", "visible"]) }),
]);

/**
 * Balas ulasan (terlihat oleh member, member dikabari lewat notifikasi) atau
 * sembunyikan/tampilkan lagi. Menampilkan lagi mengembalikan status ke
 * replied/new sesuai ada tidaknya balasan. null bila ulasan tidak ada.
 */
export function updateMemberReview(
  id: string,
  body: z.infer<typeof memberReviewPatchSchema>,
  userId: string
): Promise<{ id: string; status: string } | null> {
  return withTransaction(async (client) => {
    if ("reply" in body) {
      const { rows } = await client.query<{ id: string; customer_id: string; status: string }>(
        `UPDATE crm.member_reviews
            SET reply = $2, replied_at = now(), replied_by = $3, status = 'replied', updated_at = now()
          WHERE id = $1 RETURNING id, customer_id, status`,
        [id, cleanReviewText(body.reply, REVIEW_REPLY_MAX), userId]
      );
      if (rows[0]) {
        await notifyMember(client, rows[0].customer_id, {
          type: "review_reply",
          title: "Ulasan Anda dibalas",
          body: "Tim kami membalas ulasan Anda. Lihat di menu Ulasan.",
        });
      }
      return rows[0] ?? null;
    }
    const { rows } = await client.query<{ id: string; status: string }>(
      `UPDATE crm.member_reviews
          SET status = CASE WHEN $2 = 'hidden' THEN 'hidden'
                            WHEN reply IS NOT NULL THEN 'replied' ELSE 'new' END,
              updated_at = now()
        WHERE id = $1 RETURNING id, status`,
      [id, body.status]
    );
    return rows[0] ?? null;
  });
}
