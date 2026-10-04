// /api/purchasing/raw-materials — daftar (+ kartu status stok) & pembuatan bahan baku.
// GET juga untuk POS recipe-builder: IAM items atau pos.catalog.
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { rawMaterialStockSource } from "@/lib/api/stall-scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";
import { createRawMaterial, listRawMaterials } from "@/lib/purchasing/raw-material-api";
import {
  prepareMaterialBody,
  rawMaterialCreateSchema,
} from "@/lib/purchasing/raw-material-api-rules";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.itemsCatalog);
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  // Stok per stall: view berdimensi warehouse saat ada stall aktif, agregat saat "Semua Stall".
  const stockSource = await rawMaterialStockSource();
  const sp = new URL(request.url).searchParams;
  const result = await listRawMaterials(db, scope, stockSource, {
    search: sp.get("search"),
    kategori: sp.get("kategori"),
    satuanBesarId: sp.get("satuan_besar_id"),
    isActive: sp.get("is_active"),
    belowMinimum: sp.get("below_minimum") === "true",
    page: parseInt(sp.get("page") || "1"),
    limit: parseInt(sp.get("limit") || "20"),
    sortBy: sp.get("sort_by") || "nama",
    ascending: sp.get("sort_dir")?.toUpperCase() !== "DESC",
  });
  return NextResponse.json(result);
}, "purchasing.raw-materials.list");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  const input = parseBodyOrThrow(
    rawMaterialCreateSchema,
    prepareMaterialBody(await request.json())
  );
  const data = await createRawMaterial(db, scope, input);
  return NextResponse.json(
    { success: true, data, message: "Raw material added successfully" },
    { status: 201 }
  );
}, "purchasing.raw-materials.create");
