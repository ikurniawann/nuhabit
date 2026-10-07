import { NextResponse, type NextRequest } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createPosition, positionSchema, listPositions } from "@/lib/hris/master-data";

const READERS = [...IAM.hris, ...IAM.settingsUsers];

export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(READERS);
  return NextResponse.json({ data: await listPositions() });
}, "master/positions");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisMaster);
  const data = await createPosition(await validateBody(request, positionSchema));
  return NextResponse.json({ data, message: "Jabatan berhasil ditambahkan" }, { status: 201 });
}, "master/positions");
