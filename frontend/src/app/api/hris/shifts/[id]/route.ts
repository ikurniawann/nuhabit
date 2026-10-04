import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { deleteShift, updateShift, updateShiftSchema } from "@/lib/hris/shifts-repo";
import { readJson, requireUuid } from "@/lib/hris/workforce-route";
import { IAM } from "@/lib/iam/prefixes";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH: perbarui master shift. */
export const PATCH = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  await requireIamMenuPrefix(IAM.hrisKepegawaian);
  const id = requireUuid((await params).id, "ID shift tidak valid");
  await updateShift(id, await readJson(request, updateShiftSchema));
  return NextResponse.json({ message: "Shift diperbarui" });
}, "hris/shifts/[id].PATCH");

/** DELETE: hapus bila belum dipakai; bila sudah, dinonaktifkan. */
export const DELETE = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  await requireIamMenuPrefix(IAM.hrisKepegawaian);
  const id = requireUuid((await params).id, "ID shift tidak valid");
  return NextResponse.json({ message: await deleteShift(id) });
}, "hris/shifts/[id].DELETE");
