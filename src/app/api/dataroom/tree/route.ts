import { NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { listAllFolders } from "@/lib/dataroom/nodes";
import { createAccessResolver, resolveActor } from "@/lib/dataroom/access";

/** GET /api/dataroom/tree — semua folder (untuk dialog "Pindahkan ke"). */
export const GET = apiHandler(async () => {
  const user = await requireIamMenuPrefix(IAM.dataroom);
  const access = await createAccessResolver(await resolveActor(user));
  const folders = (await listAllFolders()).filter((f) => access.allowsFolder(f.id));
  return NextResponse.json({ success: true, data: folders });
}, "dataroom.tree.GET");
