import { NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { mapQcDetail, QC_INSPECTION_SELECT, type QcInspectionRow } from "@/lib/purchasing/qc-inspections";

// GET /api/purchasing/qc/:id
export const GET = apiHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireIamMenuPrefix(IAM.items);
    const { id } = await params;

    const { data, error } = await (await createServerPgClient())
      .from("grn_qc_inspections")
      .select(QC_INSPECTION_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw ApiError.notFound("QC inspection tidak ditemukan");

    return successResponse(mapQcDetail(data as QcInspectionRow));
  },
  "purchasing.qc.detail"
);
