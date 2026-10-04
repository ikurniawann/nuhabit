import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { listProductRecipes } from "@/lib/purchasing/production-recipes";

// GET /api/purchasing/production/product-recipes
export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.items);
  const data = await listProductRecipes(await createServerPgClient());
  return NextResponse.json({ success: true, data });
}, "purchasing.production.product-recipes");
