import { NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { listDeliveriesForGrn } from "@/lib/purchasing/delivery-service";
import { parsePurchasingModuleType } from "@/lib/purchasing/module-scope";

// GET /api/purchasing/delivery/for-grn — delivery yang siap dibuatkan GRN
export const GET = apiHandler(async (request: Request) => {
  await requireIamMenuPrefix(IAM.items);
  const moduleType = parsePurchasingModuleType(new URL(request.url).searchParams.get("module_type"));
  const data = await listDeliveriesForGrn(await createServerPgClient(), moduleType);
  return NextResponse.json({ data });
}, "purchasing.delivery.for-grn");
