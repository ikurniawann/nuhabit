import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { query, queryOne } from "@/lib/db";

const brandCreateSchema = z.object({
  name: z.string().trim().min(1, "Nama brand wajib diisi").max(100),
  industry: z.string().trim().max(50).nullish(),
  logo_url: z.string().trim().max(500).nullish(),
});

// GET /api/brands (?active=true untuk brand aktif saja), urut nama
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hris);
  const activeOnly = new URL(request.url).searchParams.get("active") === "true";
  const data = await query(
    `SELECT * FROM item.brands ${activeOnly ? "WHERE is_active = true" : ""} ORDER BY name`
  );
  return NextResponse.json({ data, count: data.length });
}, "api/brands");

// POST /api/brands
export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.settingsBusiness);
  const body = await validateBody(request, brandCreateSchema);
  const data = await queryOne(
    "INSERT INTO item.brands (name, industry, logo_url) VALUES ($1, $2, $3) RETURNING *",
    [body.name, body.industry || "F&B", body.logo_url || null]
  );
  return NextResponse.json({ data }, { status: 201 });
}, "api/brands");
