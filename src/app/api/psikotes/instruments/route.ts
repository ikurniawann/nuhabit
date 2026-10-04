import { NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { listInstruments } from "@/lib/recruitment/psikotes-admin";
import { enforceRateLimit } from "@/lib/recruitment/route-helpers";

/**
 * GET /api/psikotes/instruments: daftar instrumen utk halaman manajemen
 * (termasuk nonaktif + jumlah soal). Rate limit di-key ke user.id, bukan
 * X-Forwarded-For yang bisa dipalsukan client.
 */
export const GET = apiHandler(async () => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  enforceRateLimit(`psikotes_instruments_get_${user.id}`);
  return NextResponse.json({ data: await listInstruments() });
}, "psikotes-instruments");
