import type { NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { privateFileResponse } from "@/lib/recruitment/private-files";

/**
 * GET /api/psikotes/files/[...path]: berkas PRIVATE psikotes (gambar tes
 * proyektif & snapshot proctoring) khusus HR. Berbeda dgn /api/files yang
 * publik: route ini ber-auth dan menolak path traversal.
 */
export const GET = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) => {
    await requireIamMenuPrefix(IAM.hrisRecruitment);
    return privateFileResponse((await params).path, "psikotes");
  },
  "psikotes-files"
);
