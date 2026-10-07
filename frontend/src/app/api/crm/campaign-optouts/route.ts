import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { addOptout, listOptouts, removeOptout } from "@/lib/crm/campaign-optouts-server";
import { requireCrmUser } from "@/lib/crm/guards";

// EPIC-033 — daftar opt-out marketing (kelola manual MVP; keyword STOP
// otomatis = Fase D). TERPISAH dari wa_consent portal.

const createSchema = z.object({
  phone: z.string().trim().min(8).max(25),
  note: z.string().trim().max(300).optional(),
});

export const GET = apiHandler(async () => {
  await requireCrmUser("campaign");
  return successResponse(await listOptouts());
}, "crm.campaign-optouts.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireCrmUser("campaign");
  const body = await validateBody(request, createSchema);
  return successResponse(await addOptout(body.phone, body.note ?? null, user.id), "Nomor masuk daftar opt-out");
}, "crm.campaign-optouts.POST");

export const DELETE = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("campaign");
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!z.string().uuid().safeParse(id).success) throw ApiError.badRequest("id tidak valid");
  await removeOptout(id);
  return successResponse({ id }, "Nomor dikeluarkan dari opt-out");
}, "crm.campaign-optouts.DELETE");
