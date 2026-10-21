import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { createSopDocument, listSopDocuments } from "@/lib/studio/sop-server";
import { sopInputSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

const MENU = ["studio.sop"] as const;

/** Dokumen SOP coach + versi terbaru + jumlah coach yang sudah konfirmasi (EPIC-067 T-067-D1). */
export async function GET() {
  return studioRoute("sop GET", async () => {
    const ctx = await requireStudioContext(undefined, MENU);
    return NextResponse.json({ success: true, data: await listSopDocuments(ctx.branchId) });
  });
}

/** Dokumen baru, langsung terbit sebagai versi 1. */
export async function POST(request: NextRequest) {
  return studioRoute("sop POST", async () => {
    const ctx = await requireStudioContext("create", MENU);
    const b = await validateBody(request, sopInputSchema);
    const id = await createSopDocument(ctx, ctx.user.id, b);
    return NextResponse.json({ success: true, data: { id }, message: "SOP diterbitkan (versi 1)" }, { status: 201 });
  });
}
