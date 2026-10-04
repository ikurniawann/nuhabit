import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import {
  applyReviewAction,
  getReviewDetail,
  reviewActionSchema,
} from "@/lib/hris/performance-repo";
import { readJson, requireUuid, requireWorkforceActor } from "@/lib/hris/workforce-route";

type Ctx = { params: Promise<{ id: string }> };

/** GET: detail review + item perilaku + KPI per bulan kuartal. */
export const GET = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const actor = await requireWorkforceActor();
  const id = requireUuid((await params).id);
  return NextResponse.json({ data: await getReviewDetail(actor, id) });
}, "hris/performance/reviews/[id].GET");

/**
 * PATCH { action }: self_assessment (karyawan), rate_item & reviewer_notes
 * (Head Division/HRD), sign (karyawan atau reviewer), finalize (HRD).
 */
export const PATCH = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const actor = await requireWorkforceActor();
  const id = requireUuid((await params).id);
  const input = await readJson(request, reviewActionSchema);
  return NextResponse.json({ message: await applyReviewAction(actor, id, input) });
}, "hris/performance/reviews/[id].PATCH");
