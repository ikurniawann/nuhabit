import "server-only";
/** Katalog paket kredit untuk admin: daftar, simpan, arsip, hapus. */
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { getPool } from "@/lib/db";

export const packageSchema = z.object({
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

export type PackageInput = z.infer<typeof packageSchema>;

const PACKAGE_SELECT = `SELECT p.id, p.name, p.description, p.credits, p.price_idr::float AS price_idr, p.validity_days,
       p.purchase_limit_per_member, p.applicable_class_type_ids, p.branch_id, b.name AS branch_name,
       p.status, p.sort_order, p.created_at, p.updated_at,
       (SELECT count(*)::int FROM gym.credit_purchases cp WHERE cp.package_id = p.id AND cp.status = 'paid') AS sold_count,
       EXISTS (SELECT 1 FROM gym.credit_purchases cp WHERE cp.package_id = p.id)
         OR EXISTS (SELECT 1 FROM gym.credit_lots l WHERE l.package_id = p.id) AS referenced
  FROM gym.credit_packages p LEFT JOIN configuration.branches b ON b.id = p.branch_id`;

/** Semua paket (aktif dulu) + jenis kelas aktif untuk pilihan cakupan. */
export async function listPackagesAdmin() {
  const pool = getPool();
  const packages = await pool.query(`${PACKAGE_SELECT} ORDER BY (p.status = 'archived'), p.sort_order, p.price_idr`);
  // gym.class_types milik modul jadwal; belum ada = daftar kosong.
  const { rows: ready } = await pool.query(`SELECT to_regclass('gym.class_types') IS NOT NULL AS ok`);
  const classTypes = ready[0]?.ok
    ? await pool.query(`SELECT id, name FROM gym.class_types WHERE status = 'active' ORDER BY name`)
    : { rows: [] };
  return { packages: packages.rows, class_types: classTypes.rows };
}

/** Buat atau ubah paket. Pembelian lama tetap memakai kredit & harga saat dibeli. */
export async function savePackage(p: PackageInput, actorId: string): Promise<{ id: string }> {
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
    ? await getPool().query<{ id: string }>(
        `UPDATE gym.credit_packages
            SET name=$1, description=$2, credits=$3, price_idr=$4, validity_days=$5, purchase_limit_per_member=$6,
                applicable_class_type_ids=$7, branch_id=$8, sort_order=$9, updated_at=now()
          WHERE id=$10 RETURNING id`,
        [...params, p.id]
      )
    : await getPool().query<{ id: string }>(
        `INSERT INTO gym.credit_packages
           (name, description, credits, price_idr, validity_days, purchase_limit_per_member,
            applicable_class_type_ids, branch_id, sort_order, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [...params, actorId]
      );
  if (!rows[0]) throw ApiError.notFound("Paket tidak ditemukan");
  return rows[0];
}

/** Arsipkan (berhenti dijual) atau aktifkan lagi. */
export async function setPackageStatus(id: string, status: "active" | "archived") {
  const { rows } = await getPool().query<{ id: string; status: string }>(
    `UPDATE gym.credit_packages SET status = $2, updated_at = now() WHERE id = $1 RETURNING id, status`,
    [id, status]
  );
  if (!rows[0]) throw ApiError.notFound("Paket tidak ditemukan");
  return rows[0];
}

/**
 * Hapus paket yang belum pernah dibeli. Paket dengan riwayat pembelian/lot
 * hanya bisa diarsipkan supaya riwayat lama tetap terbaca.
 */
export async function deletePackage(id: string): Promise<void> {
  const { rows } = await getPool().query(
    `DELETE FROM gym.credit_packages p
      WHERE p.id = $1
        AND NOT EXISTS (SELECT 1 FROM gym.credit_purchases WHERE package_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM gym.credit_lots WHERE package_id = p.id)
      RETURNING id`,
    [id]
  );
  if (rows[0]) return;
  const { rowCount } = await getPool().query(`SELECT 1 FROM gym.credit_packages WHERE id = $1`, [id]);
  throw rowCount
    ? ApiError.conflict("Paket sudah pernah dibeli. Arsipkan saja agar riwayat tetap utuh.")
    : ApiError.notFound("Paket tidak ditemukan");
}
