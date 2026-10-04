import { NextRequest } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { parseSearchParams } from "@/lib/inventory/query-params";
import { listOpenBatches } from "@/lib/inventory/stock-queries";

const UUID = /^[0-9a-f-]{36}$/i;
const querySchema = z.object({ raw_material_id: z.string().regex(UUID), warehouse_id: z.string().regex(UUID) });

/** GET /api/inventory/batches?raw_material_id=&warehouse_id= — batch bersisa, urutan FEFO. */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.itemsInventory);
  const params = parseSearchParams(
    request.nextUrl.searchParams,
    querySchema,
    "raw_material_id dan warehouse_id wajib"
  );
  return Response.json({ success: true, data: await listOpenBatches(params.raw_material_id, params.warehouse_id) });
}, "GET /api/inventory/batches");
