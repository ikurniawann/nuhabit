// GET /api/purchasing/vendor-payments — daftar tagihan pembelian (per PO).
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parsePurchasingModuleType } from "@/lib/purchasing/module-scope";
import { listPurchaseInvoices } from "@/lib/purchasing/vendor-invoices";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const sp = new URL(request.url).searchParams;
  const db = await createServerPgClient();
  const data = await listPurchaseInvoices(
    db,
    {
      moduleType: parsePurchasingModuleType(sp.get("module_type")),
      search: sp.get("search")?.trim(),
      status: sp.get("status"),
    },
    await getApiUserScope()
  );
  return NextResponse.json({ success: true, data });
}, "purchasing.vendor-payments.list");
