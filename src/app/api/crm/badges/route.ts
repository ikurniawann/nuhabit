import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { requireCrmConfigRole } from "@/lib/crm/server";
import { BADGE_METRICS } from "@/lib/crm/badges";

/**
 * Badge builder (EPIC-014 Task 6) — gerbang menu crm.settings. Metrik
 * lifetime_xp memakai min_lifetime_xp; metrik lain memakai threshold.
 */

const badgeSchema = z
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

export async function GET() {
  const denied = await requireCrmConfigRole();
  if (denied) return denied;
  const { rows } = await getPool().query(
    `SELECT b.*, (SELECT count(*)::int FROM crm.crm_member_badges mb WHERE mb.badge_id = b.id) AS awarded_count
       FROM crm.crm_badges b ORDER BY b.metric, COALESCE(b.threshold, b.min_lifetime_xp)`
  );
  return NextResponse.json({ success: true, data: rows });
}

export async function POST(request: NextRequest) {
  const denied = await requireCrmConfigRole();
  if (denied) return denied;
  try {
    const payload = badgeSchema.parse(await request.json());
    const pool = getPool();
    const usesXp = payload.metric === "lifetime_xp";
    const params = [
      payload.code,
      payload.name,
      payload.image_url ?? null,
      usesXp ? payload.min_lifetime_xp : 0,
      payload.is_active,
      payload.metric,
      usesXp || payload.metric === "manual" ? null : payload.threshold,
      payload.bonus_xp,
    ];
    const { rows } = payload.id
      ? await pool.query(
          `UPDATE crm.crm_badges SET code=$1,name=$2,image_url=$3,min_lifetime_xp=$4,is_active=$5,
                  metric=$6,threshold=$7,bonus_xp=$8
            WHERE id=$9 RETURNING *`,
          [...params, payload.id]
        )
      : await pool.query(
          `INSERT INTO crm.crm_badges (code,name,image_url,min_lifetime_xp,is_active,metric,threshold,bonus_xp)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          params
        );
    if (!rows[0]) return NextResponse.json({ success: false, error: "Badge tidak ditemukan" }, { status: 404 });
    return NextResponse.json({ success: true, data: rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: "Data tidak valid" }, { status: 400 });
    }
    console.error("Error saving badge:", error);
    return NextResponse.json({ success: false, error: "Gagal menyimpan badge" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await requireCrmConfigRole();
  if (denied) return denied;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ success: false, error: "ID tidak valid" }, { status: 400 });
  }
  // Badge yang sudah diraih member = bukti pencapaian; jangan dihapus.
  const owned = await getPool().query(`SELECT 1 FROM crm.crm_member_badges WHERE badge_id=$1 LIMIT 1`, [id]);
  if (owned.rows[0]) {
    await getPool().query(`UPDATE crm.crm_badges SET is_active=false WHERE id=$1`, [id]);
    return NextResponse.json({ success: true, message: "Sudah diraih member — dinonaktifkan, bukan dihapus" });
  }
  await getPool().query(`DELETE FROM crm.crm_badges WHERE id=$1`, [id]);
  return NextResponse.json({ success: true });
}
