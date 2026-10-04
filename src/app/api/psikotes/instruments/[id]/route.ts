import { NextResponse, type NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { updateInstrument } from "@/lib/recruitment/psikotes-admin";
import { assertUuid, enforceRateLimit } from "@/lib/recruitment/route-helpers";

/** PUT /api/psikotes/instruments/[id]: update nama / aktif / config (code & kind immutable). */
export const PUT = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  assertUuid(id, "ID instrumen tidak valid");
  enforceRateLimit(`psikotes_instrument_put_${user.id}`);
  const updated = await updateInstrument(id, req);
  return NextResponse.json({ data: updated, message: "Instrumen tersimpan" });
}, "psikotes-instrument");
