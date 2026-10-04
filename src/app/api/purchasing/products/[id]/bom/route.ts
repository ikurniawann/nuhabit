// /api/purchasing/products/:id/bom — resep produk (dipakai POS recipe-builder).
// IAM items atau pos.catalog (dipakai POS recipe-builder).
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { addProductBomItem, listProductBom } from "@/lib/purchasing/bom-api";
import { productBomCreateSchema } from "@/lib/purchasing/bom-schemas";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.itemsCatalog);
  const { id } = await params;
  const data = await listProductBom(await createServerPgClient(), id);
  return NextResponse.json({ success: true, data });
}, "purchasing.products.bom.list");

export const POST = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.itemsCatalog);
  const { id } = await params;
  const db = await createServerPgClient();
  const input = parseBodyOrThrow(productBomCreateSchema, await request.json());
  const data = await addProductBomItem(db, id, input);
  return NextResponse.json(
    { success: true, data, message: "Bahan berhasil ditambahkan ke BOM" },
    { status: 201 }
  );
}, "purchasing.products.bom.create");
