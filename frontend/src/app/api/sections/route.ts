import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { query, queryOne } from "@/lib/db";
import { isUuid } from "@/lib/recruitment/candidate-query";

const READERS = [...IAM.hris, ...IAM.settingsUsers];

const sectionSchema = z.object({
  brand_id: z.string().uuid("Brand tidak valid"),
  name: z.string().trim().min(1, "Nama wajib diisi").max(100),
  code: z.string().trim().min(1, "Kode wajib diisi").max(50),
  description: z.string().nullish().transform((v) => v || null),
  color: z.string().trim().max(20).nullish().transform((v) => v || "#6B7280"),
});

// GET /api/sections?brand_id=
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(READERS);
  const brandId = new URL(request.url).searchParams.get("brand_id") || null;
  if (brandId && !isUuid(brandId)) throw ApiError.badRequest("Brand tidak valid");
  const data = await query(
    `SELECT s.*, CASE WHEN b.id IS NULL THEN NULL ELSE json_build_object('name', b.name) END AS brands
       FROM hris.sections s LEFT JOIN item.brands b ON b.id = s.brand_id
      WHERE $1::uuid IS NULL OR s.brand_id = $1
      ORDER BY s.name`,
    [brandId]
  );
  return NextResponse.json({ data, count: data.length });
}, "api/sections");

// POST /api/sections
export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisOrganization);
  const s = await validateBody(request, sectionSchema);
  const data = await queryOne(
    `INSERT INTO hris.sections (brand_id, name, code, description, color)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [s.brand_id, s.name, s.code, s.description, s.color]
  );
  return NextResponse.json({ data }, { status: 201 });
}, "api/sections");
