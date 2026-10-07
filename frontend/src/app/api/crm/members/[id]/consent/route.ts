import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { parseCrmInput, requireCrmUser } from "@/lib/crm/guards";
import { loadMemberConsent, requireMemberCustomerId, updateMemberConsent } from "@/lib/crm/member-detail-server";

type Ctx = { params: Promise<{ id: string }> };

const consentSchema = z.object({
  wa_consent: z.boolean().optional(),
  marketing_opt_out: z.boolean().optional(),
  note: z.string().trim().max(300).optional(),
});

/** Persetujuan komunikasi member: wa_consent portal + opt-out marketing per venue. */
export const GET = apiHandler(async (_request: Request, { params }: Ctx) => {
  await requireCrmUser("memberRead");
  const customerId = await requireMemberCustomerId((await params).id);
  return successResponse(await loadMemberConsent(customerId));
}, "crm.members.[id].consent.GET");

export const PUT = apiHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireCrmUser("memberRead");
  const customerId = await requireMemberCustomerId((await params).id);
  const body = parseCrmInput(consentSchema, await request.json());
  return successResponse(await updateMemberConsent(customerId, body, user.id), "Persetujuan disimpan");
}, "crm.members.[id].consent.PUT");
