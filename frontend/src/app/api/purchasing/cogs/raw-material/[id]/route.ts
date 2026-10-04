import { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { ApiError, requireIamMenuPrefix, successResponse } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { getRawMaterialCogs } from "@/lib/purchasing/cogs-estimate";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/purchasing/cogs/raw-material/:id
export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw ApiError.badRequest("Invalid raw material ID");

  return successResponse(await getRawMaterialCogs(db, id));
}, "purchasing.cogs.raw-material");
