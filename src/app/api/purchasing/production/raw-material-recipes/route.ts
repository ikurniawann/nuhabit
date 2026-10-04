import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { listRawMaterialRecipes } from "@/lib/purchasing/production-recipes";

// GET /api/purchasing/production/raw-material-recipes
export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.items);
  const data = await listRawMaterialRecipes(await createServerPgClient());
  return NextResponse.json({ success: true, data });
}, "purchasing.production.raw-material-recipes");
