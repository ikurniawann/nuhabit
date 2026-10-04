import { NextRequest } from "next/server";
import { requireIamMenuPrefix, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";
import { getGrnDetail } from "@/lib/purchasing/grn-queries";
import { updateGrnSchema } from "@/lib/purchasing/grn-schemas";
import { deleteGrn, updateGrn } from "@/lib/purchasing/grn-update";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/purchasing/grn/[id] — detail GRN + item
export const GET = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const grn = await getGrnDetail(createPgClient(), id);
  return successResponse(grn, "GRN detail retrieved");
}, "purchasing.grn.detail");

// PATCH /api/purchasing/grn/[id] — ubah status/catatan/item (GRN Continue)
export const PATCH = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const input = await validateBody(request, updateGrnSchema);
  const grn = await updateGrn(createPgClient(), id, input, user.id);
  return successResponse(grn, `GRN ${grn.nomor_grn} berhasil diupdate`);
}, "purchasing.grn.update");

// DELETE /api/purchasing/grn/[id] — soft delete
export const DELETE = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const { deleted, nomorGrn } = await deleteGrn(createPgClient(), id, user.id);
  return successResponse(deleted, `GRN ${nomorGrn} berhasil dihapus`);
}, "purchasing.grn.delete");
