import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";

// Route lama; PUT meneruskan body apa adanya ke tabel deliveries.
type Ctx = { params: Promise<{ id: string }> };

const updateLegacyDeliverySchema = z.record(z.string(), z.unknown());

export const GET = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const { data, error } = await (await createServerPgClient())
    .from("deliveries")
    .select(
      `
      *,
      po:nomor_po,status,tanggal_po,
      supplier:supplier_id(id,kode,nama_supplier)
    `
    )
    .eq("id", id)
    .single();
  if (error) throw error;
  if (!data) throw ApiError.notFound("Delivery not found");

  return NextResponse.json({ data });
}, "purchasing.deliveries.detail");

export const PUT = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const body = await validateBody(request, updateLegacyDeliverySchema);

  const { data, error } = await (await createServerPgClient())
    .from("deliveries")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(
      `
      *,
      po:nomor_po,status,
      supplier:supplier_id(id,kode,nama_supplier)
    `
    )
    .single();
  if (error) throw error;

  return NextResponse.json({ data });
}, "purchasing.deliveries.update");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const { error } = await (await createServerPgClient())
    .from("deliveries")
    .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;

  return NextResponse.json({ success: true });
}, "purchasing.deliveries.cancel");
