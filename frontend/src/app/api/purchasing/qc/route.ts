import { NextRequest } from "next/server";
import { createdResponse, paginatedResponse, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { branchScopeOr, companyScopeOr, getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { submitGrnQcInspection } from "@/lib/purchasing/grn-qc";
import { resolveOverallQcStatus } from "@/lib/purchasing/grn-qc-utils";
import {
  createQcSchema,
  mapQcListRow,
  QC_INSPECTION_SELECT,
  toQcInspectionItems,
  type QcInspectionRow,
} from "@/lib/purchasing/qc-inspections";

// GET /api/purchasing/qc — daftar inspeksi QC (grn_qc_inspections)
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const limit = parseInt(url.searchParams.get("limit") || "15", 10);
  const search = url.searchParams.get("search") || "";
  const offset = (page - 1) * limit;

  let query = db
    .from("grn_qc_inspections")
    .select(QC_INSPECTION_SELECT, { count: "exact" })
    .order("created_at", { ascending: false });

  const scope = await getApiUserScope();
  const companyOr = companyScopeOr(scope);
  if (companyOr) query = query.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) query = query.or(branchOr);
  if (search) query = query.or(`grn.nomor_grn.ilike.%${search}%`);

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw error;

  return paginatedResponse(((data || []) as QcInspectionRow[]).map(mapQcListRow), {
    page,
    limit,
    total: count ?? 0,
    totalPages: Math.ceil((count ?? 0) / limit),
  });
}, "purchasing.qc.list");

// POST /api/purchasing/qc — submit QC lewat grn_qc_inspections
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const input = await validateBody(request, createQcSchema);
  const items = toQcInspectionItems(input.items);

  const result = await submitGrnQcInspection(await createServerPgClient(), {
    grnId: input.grn_id,
    status: resolveOverallQcStatus(items),
    parameter_inspeksi: input.parameter_inspeksi,
    hasil_inspeksi: input.hasil_inspeksi,
    catatan: input.catatan ?? null,
    rekomendasi: input.rekomendasi ?? null,
    items,
    userId: user.id,
  });

  return createdResponse(
    {
      grn_id: input.grn_id,
      inspection_id: result.inspectionId,
      grn_status: result.grnStatus,
      total_accepted: result.totalAccepted,
      total_rejected: result.totalRejected,
    },
    "QC submitted successfully"
  );
}, "purchasing.qc.submit");
