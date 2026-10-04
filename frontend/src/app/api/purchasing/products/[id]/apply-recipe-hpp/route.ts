// POST /api/purchasing/products/:id/apply-recipe-hpp — harga_modal ← HPP resep.
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { applyRecipeHpp } from "@/lib/purchasing/product-api";

export const POST = apiHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireIamMenuPrefix(IAM.items);
    const { id } = await params;
    const { data, posSync, message } = await applyRecipeHpp(
      await createServerPgClient(),
      await getApiUserScope(),
      id
    );
    return NextResponse.json({ success: true, data, pos_sync: posSync, message });
  },
  "purchasing.products.apply-recipe-hpp"
);
