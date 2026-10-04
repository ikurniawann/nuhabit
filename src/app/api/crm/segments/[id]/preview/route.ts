import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmScope } from "@/lib/crm/guards";
import { parseStoredSegment, previewSegment, rememberSegmentCount, requireSegment } from "@/lib/crm/segments-server";

/** Hitung ulang anggota segmen tersimpan dan simpan jumlahnya. */
export const POST = apiHandler(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { scope } = await requireCrmScope("segments");
  const { id } = await params;
  const row = await requireSegment(id, scope);
  const result = await previewSegment(parseStoredSegment(row.source, row.definition), scope);
  await rememberSegmentCount(id, result.total);
  return successResponse(result, `${result.total} anggota`);
}, "crm.segments.[id].preview.POST");
