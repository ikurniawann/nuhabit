// /api/purchasing/raw-material-bom/:id — ubah / hapus (soft) komponen bahan baku.
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  deactivateRawMaterialBomItem,
  updateRawMaterialBomItem,
} from "@/lib/purchasing/bom-api";
import { rawMaterialBomUpdateSchema } from "@/lib/purchasing/bom-schemas";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";

type RouteContext = { params: Promise<{ id: string }> };

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const db = await createServerPgClient();
  const patch = parseBodyOrThrow(rawMaterialBomUpdateSchema, await request.json());
  const data = await updateRawMaterialBomItem(db, id, patch);
  return NextResponse.json({ success: true, data, message: "Bill of materials item updated" });
}, "purchasing.raw-material-bom.update");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  await deactivateRawMaterialBomItem(await createServerPgClient(), id);
  return NextResponse.json({ success: true, message: "Bill of materials item removed" });
}, "purchasing.raw-material-bom.delete");
