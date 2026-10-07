import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { listPoOptionsForDelivery } from "@/lib/purchasing/delivery-service";
import { parsePurchasingModuleType } from "@/lib/purchasing/module-scope";

// GET /api/purchasing/delivery/po-options — PO yang bisa dibuatkan delivery
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const { searchParams } = new URL(request.url);
  const data = await listPoOptionsForDelivery(
    await createServerPgClient(),
    parsePurchasingModuleType(searchParams.get("module_type")),
    searchParams.get("include_cancelled") === "true"
  );
  return NextResponse.json({ success: true, data });
}, "purchasing.delivery.po-options");
