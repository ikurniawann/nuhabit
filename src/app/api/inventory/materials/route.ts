import { query } from "@/lib/db";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";

/** GET /api/inventory/materials — daftar ringkas bahan baku aktif untuk filter & pemilih. */
export async function GET() {
  try {
    await requireIamMenuPrefix(IAM.itemsInventory);
    const scope = await getApiUserScope();
    const companyId = scope && !scope.isUnscoped && scope.businessScope !== "holding" ? scope.companyId : null;
    const branchId = scope && !scope.isUnscoped && scope.businessScope === "branch" ? scope.branchId : null;
    const rows = await query<{ id: string; kode: string; nama: string; satuan: string | null }>(
      `SELECT rm.id, rm.kode, rm.nama, COALESCE(u_kecil.nama, u_besar.nama) AS satuan
         FROM item.raw_materials rm
         LEFT JOIN item.units u_kecil ON u_kecil.id = rm.satuan_kecil_id
         LEFT JOIN item.units u_besar ON u_besar.id = rm.satuan_besar_id
        WHERE rm.is_active = true AND rm.deleted_at IS NULL
          AND ($1::uuid IS NULL OR rm.company_id = $1)
          AND ($2::uuid IS NULL OR rm.branch_id = $2)
        ORDER BY rm.nama
        LIMIT 2000`,
      [companyId, branchId]
    );
    return Response.json({ success: true, data: rows });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("GET /api/inventory/materials", error);
    return Response.json({ success: false, message: "Gagal memuat bahan baku" }, { status: 500 });
  }
}
