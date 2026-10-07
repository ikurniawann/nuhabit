import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { awardBadgeManually, revokeBadge } from "@/lib/crm/collectibles-server";
import { parseCrmInput, requireCrmUser } from "@/lib/crm/guards";
import { listMemberBadges, requireMemberCustomerId } from "@/lib/crm/member-detail-server";

type Ctx = { params: Promise<{ id: string }> };

const actionSchema = z.object({
  badge_id: z.string().uuid(),
  action: z.enum(["award", "revoke"]),
  reason: z.string().trim().max(300).nullable().optional(),
});

/** GET — semua badge + status dimiliki/dicabut untuk member ini. */
export const GET = apiHandler(async (_request: Request, { params }: Ctx) => {
  await requireCrmUser("memberRead");
  const customerId = await requireMemberCustomerId((await params).id);
  return successResponse(await listMemberBadges(customerId));
}, "crm.members.[id].badges.GET");

/** POST — beri atau cabut badge secara manual. */
export const POST = apiHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireCrmUser("memberLoyaltyWrite");
  const customerId = await requireMemberCustomerId((await params).id);
  const body = parseCrmInput(actionSchema, await request.json());
  if (body.action === "award") {
    const { awarded } = await awardBadgeManually({ customerId, badgeId: body.badge_id, actorId: user.id });
    return successResponse({ awarded }, awarded ? "Badge diberikan" : "Member sudah memiliki badge ini");
  }
  const { revoked } = await revokeBadge({
    customerId,
    badgeId: body.badge_id,
    actorId: user.id,
    reason: body.reason || null,
  });
  return successResponse({ revoked }, "Badge dicabut");
}, "crm.members.[id].badges.POST");
