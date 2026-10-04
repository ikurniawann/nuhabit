import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { listCycles, openCycle, openCycleSchema } from "@/lib/hris/performance-repo";
import { readJson, requireWorkforceActor } from "@/lib/hris/workforce-route";

/** GET: daftar siklus + progres (isi review disaring di endpoint reviews). */
export const GET = apiHandler(async () => {
  const actor = await requireWorkforceActor();
  return NextResponse.json({ data: { cycles: await listCycles(), is_hr: actor.isHr } });
}, "hris/performance/cycles.GET");

/** POST { period_year, period_quarter }: HRD membuka siklus baru. */
export const POST = apiHandler(async (request: NextRequest) => {
  const actor = await requireWorkforceActor();
  const input = await readJson(request, openCycleSchema);
  return NextResponse.json(await openCycle(actor, input), { status: 201 });
}, "hris/performance/cycles.POST");
