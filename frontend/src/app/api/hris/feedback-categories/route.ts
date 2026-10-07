import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { feedbackCategorySchema } from "@/lib/hris/feedback-schemas";
import { createCategory, listCategories } from "@/lib/hris/feedback-repo";
import { readJson } from "@/lib/hris/workforce-route";

// Modul 360 feedback belum punya UI; semua handler khusus pengelola kinerja.

export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
  return NextResponse.json({ data: await listCategories() });
}, "hris/feedback-categories GET");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
  const input = await readJson(request, feedbackCategorySchema, "Data tidak valid");
  return NextResponse.json({ data: await createCategory(input) }, { status: 201 });
}, "hris/feedback-categories POST");
