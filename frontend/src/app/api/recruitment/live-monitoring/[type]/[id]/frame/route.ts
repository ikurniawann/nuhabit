import { NextResponse, type NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { isUuid } from "@/lib/recruitment/candidate-query";
import { getLatestFrame, isLiveSessionType } from "@/lib/recruitment/live-monitor";

/**
 * GET /api/recruitment/live-monitoring/[type]/[id]/frame: frame webcam
 * terbaru satu sesi (image/jpeg, no-store), dipoll HR sbg "live cam".
 */
export const GET = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) => {
    await requireIamMenuPrefix(IAM.hrisRecruitment);
    const { type, id } = await params;
    if (!isLiveSessionType(type) || !isUuid(id)) throw ApiError.badRequest("Sesi tidak valid");
    const frame = await getLatestFrame(type, id);
    if (!frame) throw ApiError.notFound("Belum ada frame");
    return new NextResponse(new Uint8Array(Buffer.from(frame.frame_base64, "base64")), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
        "X-Frame-Updated-At": frame.updated_at,
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
  "live-monitoring-frame"
);
