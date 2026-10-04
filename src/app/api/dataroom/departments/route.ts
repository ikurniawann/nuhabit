import { NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { listDepartments } from "@/lib/dataroom/access";

/** GET /api/dataroom/departments — daftar departemen (untuk dialog atur akses). */
export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.dataroom);
  return NextResponse.json({ success: true, data: await listDepartments() });
}, "dataroom.departments.GET");
