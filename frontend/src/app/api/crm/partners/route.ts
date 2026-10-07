import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { parseCrmInput, requireCrmUser } from "@/lib/crm/guards";
import { createPartner, createPartnerSchema, listPartners } from "@/lib/crm/partners-admin-server";

/** GET — partner + hitungan event per status. Secret tidak pernah dikirim. */
export const GET = apiHandler(async () => {
  await requireCrmUser("partners");
  return successResponse(await listPartners());
}, "crm.partners.GET");

/** POST — partner baru; secret dibuat server dan ditampilkan sekali di respons. */
export const POST = apiHandler(async (request: Request) => {
  await requireCrmUser("partners");
  const body = parseCrmInput(createPartnerSchema, await request.json());
  return successResponse(await createPartner(body), "Partner dibuat");
}, "crm.partners.POST");
