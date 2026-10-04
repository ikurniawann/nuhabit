import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { coverUploadSchema, saveAnnouncementCover } from "@/lib/hris/announcements-repo";
import { readJson } from "@/lib/hris/workforce-route";

/**
 * POST /api/hris/announcements/cover — pengelola upload cover (JPG/PNG/WebP
 * ≤ 5 MB) ke storage private; path disajikan via cover/[...path] (ber-auth).
 */
export const POST = apiHandler(async (req: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisKepegawaian);
  const { image } = await readJson(req, coverUploadSchema, "Cover harus berupa gambar JPG/PNG/WebP");
  return NextResponse.json({ data: { path: await saveAnnouncementCover(image) } });
}, "hris/announcements/cover POST");
