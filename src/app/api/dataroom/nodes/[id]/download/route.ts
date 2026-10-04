import { NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getNode } from "@/lib/dataroom/nodes";
import { serveNodeFile } from "@/lib/dataroom/api";
import { createAccessResolver, resolveActor } from "@/lib/dataroom/access";

/** GET /api/dataroom/nodes/[id]/download?inline=1 — unduh / pratinjau (ber-auth). */
export const GET = apiHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireIamMenuPrefix(IAM.dataroom);
  const { id } = await params;
  const node = await getNode(id);
  if (!node || node.kind !== "file") throw ApiError.notFound("File tidak ditemukan");
  const access = await createAccessResolver(await resolveActor(user));
  if (!access.allows(node)) throw ApiError.forbidden("File ini tidak dibuka untuk departemen Anda");
  return serveNodeFile(node, { inline: request.nextUrl.searchParams.get("inline") === "1" });
}, "dataroom.download.GET");
