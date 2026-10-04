import type { NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { privateFileResponse } from "@/lib/recruitment/private-files";

/**
 * GET /api/interview/files/[...path]: berkas PRIVATE interview AI (rekaman,
 * audio TTS, snapshot proctoring) khusus HR; path traversal ditolak.
 */
export const GET = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) => {
    await requireIamMenuPrefix(IAM.hrisRecruitment);
    // rekaman interview = video webm (readPrivateFile memetakan .webm ke audio)
    return privateFileResponse((await params).path, "interview", (rel) =>
      rel.includes("/recording/") ? "video/webm" : undefined
    );
  },
  "interview-files"
);
