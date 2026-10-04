import { NextResponse, type NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { withTransaction } from "@/lib/db";
import { CANDIDATE_STATUS_LABELS } from "@/lib/recruitment/status";
import { logCandidateActivity, requireCandidate } from "@/lib/recruitment/candidates-repo";
import type { CandidateStatus } from "@/types";

/**
 * POST /api/candidates/[id]/stage: pindahkan kandidat ke tahap lain.
 * Satu-satunya jalur perpindahan status (pipeline drag, drawer, detail page)
 * supaya SETIAP perpindahan meninggalkan jejak di candidate_activities
 * lengkap dengan nama HR yang melakukannya.
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

const isStatus = (value: unknown): value is CandidateStatus =>
  typeof value === "string" && Object.hasOwn(CANDIDATE_STATUS_LABELS, value);

export const POST = apiHandler(async (req: NextRequest, { params }: RouteParams) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;

  const body: unknown = await req.json().catch(() => null);
  const status = typeof body === "object" && body !== null && "status" in body ? body.status : undefined;
  if (!isStatus(status)) throw ApiError.badRequest("Status tidak valid");

  const candidate = await requireCandidate(id);
  if (candidate.status === status) {
    return NextResponse.json({ data: { status }, message: "Status tidak berubah" });
  }

  const fromLabel = isStatus(candidate.status) ? CANDIDATE_STATUS_LABELS[candidate.status] : candidate.status;
  const toLabel = CANDIDATE_STATUS_LABELS[status];

  // status + jejak dalam satu transaksi: "pindah" selalu berarti "teraudit"
  await withTransaction(async (client) => {
    await client.query(
      "UPDATE recruitment.candidates SET status = $1, updated_at = now() WHERE id = $2",
      [status, id]
    );
    await logCandidateActivity(
      id,
      "status_change",
      `Tahap diubah: ${fromLabel} → ${toLabel}`,
      user,
      client
    );
  });

  return NextResponse.json({
    data: { status, previous: candidate.status },
    message: `Kandidat dipindahkan ke ${toLabel}`,
  });
}, "candidate-stage");
