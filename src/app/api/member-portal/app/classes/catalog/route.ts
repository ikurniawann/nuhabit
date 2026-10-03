import { getPool } from "@/lib/db";
import { memberJson, withMemberSession } from "@/lib/member-portal/route";

/**
 * GET — katalog pendukung aplikasi member (kelas & dompet) yang tidak ada di
 * API gym: cabang aktif, jenis kelas (deskripsi, durasi, biaya), cakupan
 * jenis kelas tiap paket kredit (termasuk paket arsip, karena lot lama
 * masih menunjuknya), dan cabang tiap coach.
 */
export const GET = withMemberSession("Gagal memuat katalog kelas", async () => {
  const pool = getPool();
  const [branches, classTypes, packages, coaches] = await Promise.all([
    pool.query(`SELECT id, name FROM configuration.branches WHERE is_active = true ORDER BY name`),
    pool.query(
      `SELECT id, name, description, default_duration_min, default_credit_cost
         FROM gym.class_types WHERE status = 'active' ORDER BY name`
    ),
    pool.query(`SELECT id, applicable_class_type_ids AS class_type_ids FROM gym.credit_packages`),
    pool.query(`SELECT id, branch_id FROM gym.coaches WHERE status = 'active'`),
  ]);
  return memberJson({
    branches: branches.rows,
    class_types: classTypes.rows,
    packages: packages.rows,
    coaches: coaches.rows,
  });
});
