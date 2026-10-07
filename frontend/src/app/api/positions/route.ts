import { NextResponse, type NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { isUuid } from "@/lib/recruitment/candidate-query";
import { createPosition, listPositions, positionSchema } from "@/lib/hris/master-data";

// GET /api/positions?brand_id=
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hris);
  const brandId = new URL(request.url).searchParams.get("brand_id") || null;
  if (brandId && !isUuid(brandId)) throw ApiError.badRequest("Brand tidak valid");
  const data = await listPositions(brandId);
  return NextResponse.json({ data, count: data.length });
}, "api/positions");

// POST /api/positions
export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisMaster);
  const data = await createPosition(await validateBody(request, positionSchema));
  return NextResponse.json({ data }, { status: 201 });
}, "api/positions");
