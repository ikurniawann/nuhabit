// /api/purchasing/products/:id — detail (+ biaya BOM), update, soft delete.
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";
import {
  getProductDetail,
  softDeleteProduct,
  updateProduct,
} from "@/lib/purchasing/product-api";
import { productUpdateSchema } from "@/lib/purchasing/product-api-schemas";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const data = await getProductDetail(
    await createServerPgClient(),
    await getApiUserScope(),
    id
  );
  return NextResponse.json({ success: true, data });
}, "purchasing.products.detail");

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  const input = parseBodyOrThrow(productUpdateSchema, await request.json());
  const { data, posSync } = await updateProduct(db, scope, id, input);
  return NextResponse.json({
    success: true,
    data,
    pos_sync: posSync,
    message: posSync
      ? "Produk berhasil diupdate dan tersinkron ke POS"
      : "Produk berhasil diupdate",
  });
}, "purchasing.products.update");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  await softDeleteProduct(await createServerPgClient(), id);
  return NextResponse.json({ success: true, message: "Produk berhasil dihapus" });
}, "purchasing.products.delete");
