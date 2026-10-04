import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireHumanTokenAdmin, revokeApiToken } from "@/lib/admin/api-tokens";

/** EPIC-042: cabut token (soft revoke — jejak audit tetap utuh). */
export const DELETE = apiHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireHumanTokenAdmin();
    return NextResponse.json({ success: true, data: await revokeApiToken((await params).id) });
  },
  "DELETE /api/admin/api-tokens/[id]"
);
