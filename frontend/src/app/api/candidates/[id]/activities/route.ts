import { NextResponse, type NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  listCandidateActivities,
  logCandidateActivity,
  requireCandidate,
} from "@/lib/recruitment/candidates-repo";

/**
 * GET  /api/candidates/[id]/activities: jejak aktivitas, terbaru dulu.
 * POST /api/candidates/[id]/activities: catat aktivitas manual dari UI.
 * Whitelist ketat: saat ini hanya pembukaan template WhatsApp (AC epic:
 * "template WA membuka wa.me + tercatat di aktivitas").
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

const WA_TEMPLATE_LABELS: Record<string, string> = {
  undangan_screening: "Undangan Screening",
  lolos_psikotes: "Lolos → Lanjut Psikotes",
  undangan_psikotes: "Undangan Psikotes Online",
  undangan_interview: "Undangan Interview AI",
  lolos_interview: "Lolos → Lanjut Interview",
  lolos_offer: "Lolos → Lanjut Offer",
  offer_terkirim: "Penawaran Kerja Terkirim",
  penolakan: "Penolakan Halus",
};

export const GET = apiHandler(async (_req: NextRequest, { params }: RouteParams) => {
  await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  await requireCandidate(id);
  return NextResponse.json({ data: await listCandidateActivities(id) });
}, "candidate-activities");

export const POST = apiHandler(async (req: NextRequest, { params }: RouteParams) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;

  // key ke user.id: X-Forwarded-For bisa dipalsukan client
  if (!checkRateLimit(`candidate_activities_post_${user.id}`).allowed) {
    throw ApiError.tooManyRequests("Terlalu banyak permintaan, coba lagi sebentar lagi");
  }

  const body: unknown = await req.json().catch(() => null);
  const template =
    typeof body === "object" && body !== null && "template" in body ? body.template : undefined;
  const label = typeof template === "string" ? WA_TEMPLATE_LABELS[template] : undefined;
  if (!label) throw ApiError.badRequest("Template tidak dikenal");

  await requireCandidate(id);
  const data = await logCandidateActivity(id, "wa_template_sent", `Template WA "${label}" dibuka`, user);
  return NextResponse.json({ data, message: "Aktivitas tercatat" }, { status: 201 });
}, "candidate-activities");
