// GET /api/purchasing/inventory/:id/movements — pergerakan terbaru satu bahan baku.
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { listMaterialMovements } from "@/lib/purchasing/inventory-queries";

export const GET = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireIamMenuPrefix(IAM.items);
    const { id } = await params;
    const db = await createServerPgClient();
    const limit = parseInt(new URL(request.url).searchParams.get("limit") || "50");
    const data = await listMaterialMovements(db, id, limit);
    return NextResponse.json({ success: true, data });
  },
  "purchasing.inventory.material-movements"
);
