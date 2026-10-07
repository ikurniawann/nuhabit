import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createShift, createShiftSchema, listShifts } from "@/lib/hris/shifts-repo";
import { readJson, requireWorkforceActor } from "@/lib/hris/workforce-route";
import { IAM } from "@/lib/iam/prefixes";

/** GET: master shift; boleh dibaca semua karyawan ber-akun (dropdown jadwal tim). */
export const GET = apiHandler(async () => {
  await requireWorkforceActor();
  return NextResponse.json({ data: await listShifts() });
}, "hris/shifts.GET");

/** POST: buat shift baru (HR kepegawaian). */
export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisKepegawaian);
  const created = await createShift(await readJson(request, createShiftSchema));
  return NextResponse.json(
    { data: created, message: `Shift "${created?.name}" dibuat` },
    { status: 201 }
  );
}, "hris/shifts.POST");
