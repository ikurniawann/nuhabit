import { NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { listOpenBatches } from "@/lib/inventory/stock-queries";

const UUID = /^[0-9a-f-]{36}$/i;

/** GET /api/inventory/batches?raw_material_id=&warehouse_id= — batch bersisa, urutan FEFO. */
export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.itemsInventory);
    const sp = request.nextUrl.searchParams;
    const rawMaterialId = sp.get("raw_material_id") ?? "";
    const warehouseId = sp.get("warehouse_id") ?? "";
    if (!UUID.test(rawMaterialId) || !UUID.test(warehouseId)) {
      return Response.json({ success: false, message: "raw_material_id dan warehouse_id wajib" }, { status: 400 });
    }
    return Response.json({ success: true, data: await listOpenBatches(rawMaterialId, warehouseId) });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("GET /api/inventory/batches", error);
    return Response.json({ success: false, message: "Gagal memuat batch" }, { status: 500 });
  }
}
