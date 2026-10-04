import { createServerPgClient } from "@/lib/pg/create-client";
import { NextResponse } from "next/server";
import { requireIamGuard } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

const READERS = [...IAM.hris, ...IAM.settingsUsers];

// GET /api/sections - List sections
export async function GET(request: Request) {
  const guard = await requireIamGuard(READERS);
  if (guard.error) return guard.error;
  const db = await createServerPgClient();
  const { searchParams } = new URL(request.url);

  let query = db
    .from("sections")
    .select("*, brands(name)", { count: "exact" })
    .order("name", { ascending: true });

  const brand_id = searchParams.get("brand_id");

  if (brand_id) query = query.eq("brand_id", brand_id);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ data, count });
}

// POST /api/sections - Create section
export async function POST(request: Request) {
  const guard = await requireIamGuard(IAM.hrisOrganization);
  if (guard.error) return guard.error;
  const db = await createServerPgClient();
  const body = await request.json();

  const { data, error } = await db
    .from("sections")
    .insert({
      brand_id: body.brand_id,
      name: body.name,
      code: body.code,
      description: body.description || null,
      color: body.color || "#6B7280",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
