import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  createDeptTask,
  deptTaskCreateSchema,
  loadDeptTaskBoard,
  loadTaskActor,
} from "@/lib/hris/dept-tasks-repo";
import { readJson, requireWorkforceActor } from "@/lib/hris/workforce-route";

/**
 * GET  ?month=YYYY-MM[&department_id=..] — task + kemunculannya pada bulan
 *      itu. HR departemen mana pun; karyawan lain departemennya sendiri.
 * POST — buat task baru. HR bebas; non-HR harus atasan dan hanya untuk
 *      departemennya sendiri.
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const GET = apiHandler(async (req: NextRequest) => {
  const me = await loadTaskActor(await requireWorkforceActor());
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!MONTH_RE.test(month)) throw ApiError.badRequest("Parameter month wajib (YYYY-MM)");
  const data = await loadDeptTaskBoard(me, month, req.nextUrl.searchParams.get("department_id"));
  return NextResponse.json({ data });
}, "hris/dept-tasks GET");

export const POST = apiHandler(async (req: NextRequest) => {
  const me = await loadTaskActor(await requireWorkforceActor());
  const body = await readJson(req, deptTaskCreateSchema);
  const id = await createDeptTask(me, body);
  return NextResponse.json({ message: "Task dibuat", data: { id } }, { status: 201 });
}, "hris/dept-tasks POST");
