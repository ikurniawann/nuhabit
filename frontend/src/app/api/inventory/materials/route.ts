import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { listActiveMaterialOptions } from "@/lib/inventory/stock-queries";

/** GET /api/inventory/materials — daftar ringkas bahan baku aktif untuk filter & pemilih. */
export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.itemsInventory);
  return Response.json({ success: true, data: await listActiveMaterialOptions(await getApiUserScope()) });
}, "GET /api/inventory/materials");
