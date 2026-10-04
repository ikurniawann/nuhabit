// /api/purchasing/products — daftar & pembuatan master produk.
// GET juga untuk POS katalog (picker produk & recipe-builder): IAM items atau pos.catalog.
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { getApiStallScope } from "@/lib/api/stall-scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";
import { createProduct, listProducts } from "@/lib/purchasing/product-api";
import { productCreateSchema } from "@/lib/purchasing/product-api-schemas";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.itemsCatalog);
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  const sp = new URL(request.url).searchParams;
  // Param eksplisit menang (mis. picker POS); selain itu ikut stall aktif sidebar.
  const stallScope = await getApiStallScope();
  const result = await listProducts(db, scope, {
    search: sp.get("search"),
    isActive: sp.get("is_active"),
    warehouseId:
      sp.get("warehouse_id") ?? (stallScope.mode === "stall" ? stallScope.warehouseId : null),
    hppReview: sp.get("hpp_review") === "true",
    page: parseInt(sp.get("page") || "1"),
    limit: parseInt(sp.get("limit") || "20"),
  });
  return NextResponse.json({ success: true, ...result });
}, "purchasing.products.list");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  const input = parseBodyOrThrow(productCreateSchema, await request.json());
  const { data, posSync } = await createProduct(db, scope, input);
  return NextResponse.json(
    {
      success: true,
      data,
      pos_sync: posSync,
      message: posSync
        ? "Produk berhasil ditambahkan dan tersinkron ke POS"
        : "Produk berhasil ditambahkan",
    },
    { status: 201 }
  );
}, "purchasing.products.create");
