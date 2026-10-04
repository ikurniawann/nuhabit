import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { listReviews, reviewListQuerySchema } from "@/lib/hris/performance-repo";
import { requireWorkforceActor } from "@/lib/hris/workforce-route";
import { parseInput, searchParamsOf } from "@/lib/payroll/request-input";

/** GET ?cycle_id: review satu siklus: HRD semua, Head Division departemennya, lainnya miliknya. */
export const GET = apiHandler(async (request: NextRequest) => {
  const actor = await requireWorkforceActor();
  const { cycle_id } = parseInput(reviewListQuerySchema, searchParamsOf(request));
  return NextResponse.json({ data: await listReviews(actor, cycle_id) });
}, "hris/performance/reviews.GET");
