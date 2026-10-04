import { NextResponse, type NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { appOrigin } from "@/lib/app-origin";
import { checkRateLimit } from "@/lib/public/rate-limit";
import { clientIp } from "@/lib/security/client-ip";
import {
  createPortalApplication,
  parseApplicationFields,
  uploadApplicationFiles,
} from "@/lib/recruitment/portal-application";
import { sendApplicationEmails } from "./emails";

/** Form karir publik: rem spam per IP (lihat model kepercayaan di client-ip). */
const SUBMIT_LIMIT = { limit: 5, windowMs: 10 * 60_000 };

/** POST /api/portal/submit: lamaran publik (multipart) → kandidat baru + email. */
export const POST = apiHandler(async (request: NextRequest) => {
  if (!checkRateLimit(`portal-submit:${clientIp(request)}`, SUBMIT_LIMIT)) {
    throw ApiError.tooManyRequests("Terlalu banyak lamaran dari jaringan ini. Coba lagi beberapa menit lagi.");
  }
  const form = await request.formData();
  const input = parseApplicationFields(form);
  const files = await uploadApplicationFiles(form);
  const saved = await createPortalApplication(input, files);

  await sendApplicationEmails({
    candidateId: saved.candidateId,
    fullName: input.full_name,
    email: input.email,
    phone: input.phone,
    domicile: input.domicile,
    source: input.source,
    notes: input.notes,
    positionTitle: saved.positionTitle,
    brandName: saved.brandName,
    origin: appOrigin(request),
  });

  return NextResponse.json({
    success: true,
    message: "Lamaran berhasil dikirim",
    candidate_id: saved.candidateId,
  });
}, "portal-submit");
