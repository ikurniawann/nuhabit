import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { queryOne } from "@/lib/db";
import { isUuid } from "@/lib/recruitment/candidate-query";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const brandPatchSchema = z.object({
  is_active: z.boolean().optional(),
  name: z.string().trim().min(1).max(100).optional(),
  industry: z.string().trim().max(50).optional(),
  logo_url: z.string().trim().max(500).nullable().optional(),
});

// PATCH /api/brands/[id]: ubah field yang dikirim saja
export const PATCH = apiHandler(async (request: NextRequest, { params }: RouteParams) => {
  await requireIamMenuPrefix(IAM.settingsBusiness);
  const { id } = await params;
  if (!isUuid(id)) throw ApiError.badRequest("ID brand tidak valid");
  const patch = await validateBody(request, brandPatchSchema);

  const cols = (Object.keys(patch) as (keyof typeof patch)[]).filter((col) => patch[col] !== undefined);
  const data = cols.length
    ? await queryOne(
        `UPDATE item.brands SET ${cols.map((col, i) => `${col} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING *`,
        [id, ...cols.map((col) => patch[col])]
      )
    : await queryOne("SELECT * FROM item.brands WHERE id = $1", [id]);
  if (!data) throw ApiError.notFound("Brand tidak ditemukan");
  return NextResponse.json({ data });
}, "api/brands/[id]");
