import { createServerPgClient } from "@/lib/pg/create-client";
import { NextResponse } from "next/server";
import { requireIamGuard } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

// GET /api/positions
export async function GET(request: Request) {
  const guard = await requireIamGuard(IAM.hris);
  if (guard.error) return guard.error;
  const db = await createServerPgClient();
  const { searchParams } = new URL(request.url);

  let query = db
    .from("positions")
    .select("*, brands(name)", { count: "exact" })
    .order("title");

  const brand_id = searchParams.get("brand_id");
  if (brand_id) query = query.eq("brand_id", brand_id);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ data, count });
}

// POST /api/positions
export async function POST(request: Request) {
  const guard = await requireIamGuard(IAM.hrisMaster);
  if (guard.error) return guard.error;
  const db = await createServerPgClient();
  const body = await request.json();

  const { data, error } = await db
    .from("positions")
    .insert({
      brand_id: body.brand_id,
      title: body.title,
      department: body.department || "Operations",
      level: body.level || "Staff",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
