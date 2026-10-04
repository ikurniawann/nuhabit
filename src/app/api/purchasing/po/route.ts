// /api/purchasing/po — daftar & pembuatan PO (raw_material | product | general).
// Scope bisnis dari sesi user.
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parsePurchasingModuleType } from "@/lib/purchasing/module-scope";
import { createPurchaseOrder, parsePoCreateBody } from "@/lib/purchasing/po-create";
import { listPurchaseOrders } from "@/lib/purchasing/po-queries";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const sp = new URL(request.url).searchParams;
  const db = await createServerPgClient();
  const result = await listPurchaseOrders(
    db,
    {
      search: sp.get("search"),
      status: sp.get("status"),
      supplierId: sp.get("supplier_id"),
      vendorId: sp.get("vendor_id"),
      moduleType: sp.get("module_type") || "raw_material",
      tanggalMulai: sp.get("tanggal_mulai"),
      tanggalSampai: sp.get("tanggal_sampai"),
      includeCancelled: Boolean(sp.get("include_cancelled")),
      page: parseInt(sp.get("page") || "1"),
      limit: parseInt(sp.get("limit") || "20"),
    },
    await getApiUserScope()
  );
  return NextResponse.json({ success: true, ...result });
}, "purchasing.po.list");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const body: unknown = await request.json();
  const moduleType = parsePurchasingModuleType(
    (body as { module_type?: string } | null)?.module_type
  );
  const input = parsePoCreateBody(body, moduleType);
  const data = await createPurchaseOrder(db, moduleType, input, await getApiUserScope());
  return NextResponse.json({ success: true, data, message: "PO berhasil dibuat" }, { status: 201 });
}, "purchasing.po.create");
