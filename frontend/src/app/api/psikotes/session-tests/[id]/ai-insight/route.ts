import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { parseBody } from "@/lib/recruitment/candidates-repo";
import { createDrawingInsight } from "@/lib/recruitment/psikotes-admin";
import { assertUuid, enforceRateLimit } from "@/lib/recruitment/route-helpers";

/**
 * POST /api/psikotes/session-tests/[id]/ai-insight: insight AI tes gambar.
 * observation diisi → mode manual; kosong → AI membaca gambarnya.
 */

const bodySchema = z.object({
  observation: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .min(20, "Tulis observasi gambar minimal 20 karakter, atau kosongkan agar AI membaca gambarnya")
        .max(4000, "Observasi maksimal 4000 karakter"),
    ])
    .optional(),
});

export const POST = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  assertUuid(id, "ID tes tidak valid");
  // panggilan LLM mahal: batasi lebih ketat dari default
  enforceRateLimit(`psikotes_ai_insight_${user.id}`, 10, "Terlalu banyak permintaan analisis, coba lagi sebentar lagi");
  const { observation } = await parseBody(req, bodySchema);
  const aiInsight = await createDrawingInsight(id, observation?.trim() ?? "", user);
  return NextResponse.json({ data: aiInsight, message: "Insight AI dibuat" });
}, "psikotes-ai-insight");
