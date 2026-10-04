import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { listDepartments } from "@/lib/hris/employees-profile";

/**
 * GET /api/hris/departments — daftar departemen (id, name, code) untuk
 * selektor, a.l. target pengumuman. Cukup login.
 */
export const GET = apiHandler(async () => {
  await requireApiUser();
  return NextResponse.json({ data: await listDepartments() });
}, "hris/departments GET");
