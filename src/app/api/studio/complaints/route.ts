import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { COMPLAINT_CATEGORIES, COMPLAINT_KINDS, COMPLAINT_STATUSES, type ComplaintCategory, type ComplaintKind, type ComplaintStatus } from "@/lib/studio/complaints";
import { createComplaint, findOpenWaComplaint, listComplaints } from "@/lib/studio/complaints-server";
import { complaintCreateSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

const MENU = ["studio.complaints"] as const;

/** Daftar tiket keluhan (EPIC-067 T-067-B1/B2). ?status=open|<status>&kind=&category=&q=&assignee=me&wa_conversation_id= */
export async function GET(request: NextRequest) {
  return studioRoute("complaints GET", async () => {
    const ctx = await requireStudioContext(undefined, MENU);
    const sp = request.nextUrl.searchParams;
    const wa = sp.get("wa_conversation_id");
    if (wa) return NextResponse.json({ success: true, data: await findOpenWaComplaint(wa) });
    const status = sp.get("status");
    const category = sp.get("category");
    const kind = sp.get("kind");
    const data = await listComplaints(ctx.branchId, {
      status: status === "open" || (COMPLAINT_STATUSES as readonly string[]).includes(status ?? "") ? (status as ComplaintStatus | "open") : undefined,
      kind: (COMPLAINT_KINDS as readonly string[]).includes(kind ?? "") ? (kind as ComplaintKind) : undefined,
      category: (COMPLAINT_CATEGORIES as readonly string[]).includes(category ?? "") ? (category as ComplaintCategory) : undefined,
      q: sp.get("q") ?? undefined,
      assigneeUserId: sp.get("assignee") === "me" ? ctx.user.id : undefined,
    });
    return NextResponse.json({ success: true, data });
  });
}

/** Tiket baru dari front desk. */
export async function POST(request: NextRequest) {
  return studioRoute("complaints POST", async () => {
    const ctx = await requireStudioContext("create", MENU);
    const b = await validateBody(request, complaintCreateSchema);
    const data = await createComplaint(ctx, ctx.user.id, { ...b, source: "front_desk" });
    return NextResponse.json({ success: true, data, message: `Tiket ${data.code} dibuat` }, { status: 201 });
  });
}
