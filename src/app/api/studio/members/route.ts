import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { normalizeMemberPhone, VENUE_TODAY_SQL } from "@/lib/studio/pass-server";
import { memberCreateSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/** Cari member (pos.pos_customers) per nama / HP, beserta jumlah pass aktif. */
export async function GET(request: NextRequest) {
  return studioRoute("members GET", async () => {
    const ctx = await requireStudioContext();
    const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 2) return NextResponse.json({ success: true, data: [] });
    const digits = q.replace(/\D/g, "");
    const rows = await query(
      `SELECT c.id, c.name, c.phone, c.email, c.photo_url,
              (SELECT COUNT(*)::int FROM studio.member_passes mp
                WHERE mp.customer_id = c.id AND mp.branch_id = $1 AND mp.status IN ('active','exhausted')
                  AND mp.valid_until >= ${VENUE_TODAY_SQL}) AS active_passes
       FROM pos.pos_customers c
       WHERE c.is_active IS NOT FALSE
         AND (c.name ILIKE $2 OR ($3 <> '' AND regexp_replace(COALESCE(c.phone,''), '\\D', '', 'g') LIKE $4))
       ORDER BY c.name NULLS LAST
       LIMIT 20`,
      [ctx.branchId, `%${q}%`, digits, `%${digits.replace(/^0/, "")}%`]
    );
    return NextResponse.json({ success: true, data: rows });
  });
}

/** Daftarkan member baru dari front desk. Nomor HP = identitas login Member App. */
export async function POST(request: NextRequest) {
  return studioRoute("members POST", async () => {
    await requireStudioContext("create");
    const b = await validateBody(request, memberCreateSchema);
    const phone = normalizeMemberPhone(b.phone);
    if (!phone) throw ApiError.badRequest("Nomor HP tidak valid");
    const existing = await queryOne<{ id: string; name: string | null }>(
      `SELECT id, name FROM pos.pos_customers WHERE regexp_replace(phone, '\\D', '', 'g') = $1 LIMIT 1`,
      [phone]
    );
    if (existing) throw ApiError.conflict(`Nomor HP sudah terdaftar atas nama ${existing.name ?? "member lain"}`);
    const rows = await query(
      `INSERT INTO pos.pos_customers (name, phone, email, birth_date, gender, member_type, is_active)
       VALUES ($1,$2,$3,$4,$5,'registered',true) RETURNING id, name, phone, email`,
      [b.name, phone, b.email ?? null, b.birth_date ?? null, b.gender ?? null]
    );
    return NextResponse.json({ success: true, data: rows[0], message: `Member ${b.name} terdaftar` }, { status: 201 });
  });
}
