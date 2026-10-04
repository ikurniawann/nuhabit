// GET /api/purchasing/inventory/:id — stok satu bahan baku (id = raw_material_id).
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { rawMaterialStockSource } from "@/lib/api/stall-scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { getRawMaterialStock } from "@/lib/purchasing/inventory-queries";

export const GET = apiHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireIamMenuPrefix(IAM.items);
    const { id } = await params;
    const db = await createServerPgClient();
    const data = await getRawMaterialStock(db, await rawMaterialStockSource(), id);
    return NextResponse.json({ success: true, data });
  },
  "purchasing.inventory.detail"
);
