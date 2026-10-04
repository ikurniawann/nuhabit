// GET /api/purchasing/inventory/movements?bahan_id=&tipe=&date_from=&date_to=
// Dibatasi cabang efektif user.
import { NextRequest } from "next/server";
import { paginatedResponse, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { effectiveBranchId, getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  listInventoryMovements,
  movementListQuerySchema,
} from "@/lib/purchasing/inventory-queries";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const branchId = effectiveBranchId(await getApiUserScope());
  const params = parseBodyOrThrow(
    movementListQuerySchema,
    Object.fromEntries(new URL(request.url).searchParams)
  );
  const { rows, meta } = await listInventoryMovements(db, branchId, params);
  return paginatedResponse(rows, meta);
}, "purchasing.inventory.movements");
