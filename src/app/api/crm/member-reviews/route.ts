import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { crmOk, crmRoute } from "@/lib/crm/crm-route";
import { summarizeReviews, type RatingCountRow } from "@/lib/crm/member-reviews";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * GET — daftar ulasan member + ringkasan. Filter: status, rating, branch_id,
 * q (nama/telepon/komentar), from/to (YYYY-MM-DD). Ringkasan memakai filter
 * outlet/tanggal/pencarian saja supaya rata-rata tidak bergeser karena
 * filter status atau bintang.
 */
export const GET = crmRoute(IAM.crmMemberReviews, "Gagal memuat ulasan member", async (_userId, request: NextRequest) => {
  const sp = request.nextUrl.searchParams;
  const base: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (p: string) => string, value: unknown) => {
    params.push(value);
    base.push(clause(`$${params.length}`));
  };
  const branchId = sp.get("branch_id");
  if (branchId && UUID.test(branchId)) add((p) => `r.branch_id = ${p}`, branchId);
  const from = sp.get("from");
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    add((p) => `(r.created_at AT TIME ZONE 'Asia/Jakarta')::date >= ${p}::date`, from);
  }
  const to = sp.get("to");
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
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
  const from_ = `FROM crm.member_reviews r
    JOIN pos.pos_customers c ON c.id = r.customer_id
    LEFT JOIN configuration.branches b ON b.id = r.branch_id`;

  const pool = getPool();
  const [reviews, counts, outlets] = await Promise.all([
    pool.query(
      `SELECT r.id, r.order_id, o.order_number, o.total_amount::float AS order_total,
              r.rating, r.comment, r.status, r.reply, r.replied_at, r.created_at,
              c.id AS customer_id, c.name AS member_name, c.phone AS member_phone,
              r.branch_id, b.name AS outlet_name, u.full_name AS replied_by_name
         ${from_}
         JOIN pos.pos_orders o ON o.id = r.order_id
         LEFT JOIN configuration.users u ON u.id = r.replied_by
         ${whereSql(listWhere)}
        ORDER BY r.created_at DESC
        LIMIT 200`,
      listParams
    ),
    pool.query<RatingCountRow>(
      `SELECT r.branch_id, b.name AS branch_name, r.rating, count(*)::int AS n
         ${from_}
         ${whereSql([...base, "r.status <> 'hidden'"])}
        GROUP BY r.branch_id, b.name, r.rating`,
      params
    ),
    pool.query(
      `SELECT DISTINCT b.id, b.name FROM crm.member_reviews r
         JOIN configuration.branches b ON b.id = r.branch_id ORDER BY b.name`
    ),
  ]);
  return crmOk({
    reviews: reviews.rows,
    summary: summarizeReviews(counts.rows),
    outlets: outlets.rows,
  });
});
