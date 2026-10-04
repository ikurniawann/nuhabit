// /api/purchasing/raw-materials/:id/bom — komponen bahan baku olahan.
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { addRawMaterialBomItem, listRawMaterialBom } from "@/lib/purchasing/bom-api";
import { rawMaterialBomCreateSchema } from "@/lib/purchasing/bom-schemas";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const data = await listRawMaterialBom(await createServerPgClient(), id);
  return NextResponse.json({ success: true, data });
}, "purchasing.raw-materials.bom.list");

export const POST = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const db = await createServerPgClient();
  const input = parseBodyOrThrow(rawMaterialBomCreateSchema, await request.json());
  const data = await addRawMaterialBomItem(db, id, input);
  return NextResponse.json(
    { success: true, data, message: "Component added to bill of materials" },
    { status: 201 }
  );
}, "purchasing.raw-materials.bom.create");
