import { createServerPgClient } from "@/lib/pg/create-client";
import { NextResponse } from "next/server";
import { requireIamGuard } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

// GET /api/brands
export async function GET() {
  const guard = await requireIamGuard(IAM.hris);
  if (guard.error) return guard.error;
  const db = await createServerPgClient();

  const { data, error, count } = await db
    .from("brands")
    .select("*", { count: "exact" })
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ data, count });
}

// POST /api/brands
export async function POST(request: Request) {
  const guard = await requireIamGuard(IAM.settingsBusiness);
  if (guard.error) return guard.error;
  const db = await createServerPgClient();
  const body = await request.json();

  const { data, error } = await db
    .from("brands")
    .insert({
      name: body.name,
      industry: body.industry || "F&B",
      logo_url: body.logo_url || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
