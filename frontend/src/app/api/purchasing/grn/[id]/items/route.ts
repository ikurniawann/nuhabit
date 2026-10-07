import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";

type Ctx = { params: Promise<{ id: string }> };

// Body lama diteruskan apa adanya ke grn_items; bahan_baku_id = alias raw_material_id.
const grnItemBodySchema = z.record(z.string(), z.unknown());

// GET /api/purchasing/grn/[id]/items (route lama).
export const GET = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const { data, error } = await (await createServerPgClient())
    .from("grn_items")
    .select(
      `
      *,
      raw_material:raw_materials!raw_material_id(*),
      satuan:units!satuan_id(*),
      purchase_order_item:purchase_order_items!purchase_order_item_id(*),
      pos_sku:pos_product_skus!pos_sku_id(id, sku, name)
    `
    )
    .eq("grn_id", id)
    .eq("is_active", true)
    .order("created_at");
  if (error) throw error;

  return NextResponse.json({ data: data || [] });
}, "purchasing.grn.items.list");

// POST /api/purchasing/grn/[id]/items — tambah baris ke GRN pending.
export const POST = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const body = await validateBody(request, grnItemBodySchema);
  const db = await createServerPgClient();

  const { data: grn } = await db.from("grn").select("status").eq("id", id).single();
  if (!grn || grn.status !== "pending") {
    throw ApiError.badRequest("Cannot add items to GRN that is not pending");
  }

  const { data, error } = await db
    .from("grn_items")
    .insert({
      ...body,
      grn_id: id,
      raw_material_id: body.raw_material_id || body.bahan_baku_id,
      satuan_id: body.satuan_id,
    })
    .select(
      `
      *,
      raw_material:raw_materials!raw_material_id(*),
      satuan:units!satuan_id(*)
    `
    )
    .single();
  if (error) throw error;

  return NextResponse.json({ data });
}, "purchasing.grn.items.create");
