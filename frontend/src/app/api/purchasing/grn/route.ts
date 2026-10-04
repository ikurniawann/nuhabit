import { NextRequest } from "next/server";
import {
  ApiError,
  createdResponse,
  paginatedResponse,
  requireIamMenuPrefix,
  validateBody,
} from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requestMeta } from "@/lib/audit";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient, createServerPgClient } from "@/lib/pg/create-client";
import { createGrn } from "@/lib/purchasing/grn-create";
import { listGrns } from "@/lib/purchasing/grn-queries";
import { createGrnSchema, grnListQuerySchema } from "@/lib/purchasing/grn-schemas";
import { parseSearchParams } from "@/lib/purchasing/receiving-query";

// GET /api/purchasing/grn — daftar GRN ber-scope
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const params = parseSearchParams(request, grnListQuerySchema);
  const { data, total } = await listGrns(await createServerPgClient(), params);

  return paginatedResponse(
    data,
    { page: params.page, limit: params.limit, total, totalPages: Math.ceil(total / params.limit) },
    "GRN list retrieved"
  );
}, "purchasing.grn.list");

// POST /api/purchasing/grn — catat penerimaan barang
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const input = await validateBody(request, createGrnSchema);
  // Klien admin (tanpa RLS) untuk semua baca/tulis PO, delivery dan GRN internal.
  const { grn, status, message } = await createGrn(createPgClient(), input, user, requestMeta(request));
  return createdResponse({ ...grn, status }, message);
}, "purchasing.grn.create");

// PATCH massal tidak didukung; pakai /api/purchasing/grn/[id].
export const PATCH = apiHandler(async () => {
  throw ApiError.badRequest("Use /api/purchasing/grn/[id] for updates");
}, "purchasing.grn.patch");
