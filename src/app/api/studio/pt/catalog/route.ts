import { NextResponse } from "next/server";
import { loadPtCatalog } from "@/lib/studio/pt-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/** Program Personal Training + coach yang bisa melatihnya. */
export async function GET() {
  return studioRoute("pt catalog", async () => {
    const ctx = await requireStudioContext();
    return NextResponse.json({ success: true, data: await loadPtCatalog(ctx.branchId) });
  });
}
