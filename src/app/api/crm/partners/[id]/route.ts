import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { parseCrmInput, requireCrmUser } from "@/lib/crm/guards";
import { patchPartnerSchema, updatePartner } from "@/lib/crm/partners-admin-server";

/** PATCH — ubah partner, atau rotasi secret (secret baru tampil sekali). */
export const PATCH = apiHandler(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireCrmUser("partners");
  const { id } = await params;
  const body = parseCrmInput(patchPartnerSchema, await request.json());
  const { secret } = await updatePartner(id, body);
  return successResponse({ id, ...(secret ? { secret } : {}) }, secret ? "Secret baru dibuat" : "Partner diperbarui");
}, "crm.partners.[id].PATCH");
