import { z } from "zod";
import { getPool } from "@/lib/db";
import { fail, gymAdminRoute, ok } from "@/lib/gym/credits-admin-route";
import { IAM } from "@/lib/iam/prefixes";

const packageSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Nama paket minimal 2 huruf").max(120),
  description: z.string().max(1_000).default(""),
  credits: z.number().int().min(1, "Kredit minimal 1").max(1_000),
  price_idr: z.number().min(0).max(1_000_000_000),
  validity_days: z.number().int().min(1, "Masa berlaku minimal 1 hari").max(3650),
  purchase_limit_per_member: z.number().int().min(1).max(1_000).nullable().default(null),
  applicable_class_type_ids: z.array(z.string().uuid()).min(1).nullable().default(null),
  branch_id: z.string().uuid().nullable().default(null),
  sort_order: z.number().int().min(0).max(10_000).default(0),
});

const PACKAGE_SELECT = `SELECT p.id, p.name, p.description, p.credits, p.price_idr::float AS price_idr, p.validity_days,
       p.purchase_limit_per_member, p.applicable_class_type_ids, p.branch_id, b.name AS branch_name,
       p.status, p.sort_order, p.created_at, p.updated_at,
       (SELECT count(*)::int FROM gym.credit_purchases cp WHERE cp.package_id = p.id AND cp.status = 'paid') AS sold_count,
       EXISTS (SELECT 1 FROM gym.credit_purchases cp WHERE cp.package_id = p.id)
         OR EXISTS (SELECT 1 FROM gym.credit_lots l WHERE l.package_id = p.id) AS referenced
  FROM gym.credit_packages p LEFT JOIN configuration.branches b ON b.id = p.branch_id`;

/**
 * GET — semua paket (aktif dulu) + jenis kelas aktif untuk pilihan cakupan.
 * Front desk (Kredit Member) ikut membaca untuk menjual.
 */
export const GET = gymAdminRoute([...IAM.gymPackages, ...IAM.gymCredits], "Gagal memuat paket", async () => {
  const pool = getPool();
  const packages = await pool.query(`${PACKAGE_SELECT} ORDER BY (p.status = 'archived'), p.sort_order, p.price_idr`);
  // gym.class_types milik modul jadwal; belum ada = daftar kosong.
  const { rows: ready } = await pool.query(`SELECT to_regclass('gym.class_types') IS NOT NULL AS ok`);
  const classTypes = ready[0]?.ok
    ? await pool.query(`SELECT id, name FROM gym.class_types WHERE status = 'active' ORDER BY name`)
    : { rows: [] };
  return ok({ packages: packages.rows, class_types: classTypes.rows });
});

/** POST — buat atau ubah paket. Pembelian lama tetap memakai kredit & harga saat dibeli. */
export const POST = gymAdminRoute(IAM.gymPackages, "Gagal menyimpan paket", async (user, request: Request) => {
  const p = packageSchema.parse(await request.json());
  const params = [
    p.name,
    p.description,
    p.credits,
    p.price_idr,
    p.validity_days,
    p.purchase_limit_per_member,
    p.applicable_class_type_ids,
    p.branch_id,
    p.sort_order,
  ];
  const { rows } = p.id
    ? await getPool().query(
        `UPDATE gym.credit_packages
            SET name=$1, description=$2, credits=$3, price_idr=$4, validity_days=$5, purchase_limit_per_member=$6,
                applicable_class_type_ids=$7, branch_id=$8, sort_order=$9, updated_at=now()
          WHERE id=$10 RETURNING id`,
        [...params, p.id]
      )
    : await getPool().query(
        `INSERT INTO gym.credit_packages
           (name, description, credits, price_idr, validity_days, purchase_limit_per_member,
            applicable_class_type_ids, branch_id, sort_order, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [...params, user.id]
      );
  if (!rows[0]) return fail("Paket tidak ditemukan", 404);
  return ok(rows[0]);
});
