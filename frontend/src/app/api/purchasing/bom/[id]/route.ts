// /api/purchasing/bom/:id — ubah / hapus (soft) baris resep produk.
// IAM items atau pos.catalog (dipakai POS recipe-builder).
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { deactivateProductBomItem, updateProductBomItem } from "@/lib/purchasing/bom-api";
import { productBomUpdateSchema } from "@/lib/purchasing/bom-schemas";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";

type RouteContext = { params: Promise<{ id: string }> };

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.itemsCatalog);
  const { id } = await params;
  const db = await createServerPgClient();
  const patch = parseBodyOrThrow(productBomUpdateSchema, await request.json());
  const data = await updateProductBomItem(db, id, patch);
  return NextResponse.json({ success: true, data, message: "Item BOM berhasil diupdate" });
}, "purchasing.bom.update");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.itemsCatalog);
  const { id } = await params;
  await deactivateProductBomItem(await createServerPgClient(), id);
  return NextResponse.json({ success: true, message: "Bahan berhasil dihapus dari BOM" });
}, "purchasing.bom.delete");
