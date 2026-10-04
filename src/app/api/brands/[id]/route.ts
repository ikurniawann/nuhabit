import { createServerPgClient } from "@/lib/pg/create-client";
import { NextResponse } from "next/server";
import { requireIamGuard } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const guard = await requireIamGuard(IAM.settingsBusiness);
  if (guard.error) return guard.error;
  const db = await createServerPgClient();
  const { id } = await params;
  const body = await request.json();

  const update: Record<string, unknown> = {};
  if (typeof body.is_active === "boolean") update.is_active = body.is_active;
  if (typeof body.name === "string") update.name = body.name;
  if (typeof body.industry === "string") update.industry = body.industry;
  if (body.logo_url !== undefined) update.logo_url = body.logo_url;

  const { data, error } = await db
    .from("brands")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ data });
}
