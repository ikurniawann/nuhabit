import { z } from "zod";
import { getPool } from "@/lib/db";
import { crmFail, crmOk, crmRoute } from "@/lib/crm/crm-route";
import { awardBadgeManually, revokeBadge } from "@/lib/crm/collectibles-server";
import {
  MEMBER_LOYALTY_WRITE_MENUS,
  MEMBER_READ_MENUS,
  resolveCustomerId,
} from "@/lib/crm/member-detail-server";

type Ctx = { params: Promise<{ id: string }> };

/** GET — semua badge + status dimiliki/dicabut untuk member ini. */
export const GET = crmRoute(MEMBER_READ_MENUS, "Gagal memuat badge member", async (_userId, _request: Request, { params }: Ctx) => {
  const customerId = await resolveCustomerId((await params).id);
  if (!customerId) return crmFail("Member tidak ditemukan", 404);
  const { rows } = await getPool().query(
    `SELECT b.id, b.code, b.name, b.image_url, b.metric, b.threshold::float AS threshold,
            b.min_lifetime_xp, b.bonus_xp, b.is_active,
            mb.awarded_at, mb.source, rv.revoked_at, rv.reason AS revoke_reason
       FROM crm.crm_badges b
       LEFT JOIN crm.crm_member_badges mb ON mb.badge_id = b.id AND mb.customer_id = $1
       LEFT JOIN crm.crm_member_badge_revocations rv ON rv.badge_id = b.id AND rv.customer_id = $1
      WHERE b.is_active OR mb.id IS NOT NULL
      ORDER BY (mb.id IS NULL), b.name`,
    [customerId]
  );
  return crmOk(rows);
});

const actionSchema = z.object({
  badge_id: z.string().uuid(),
  action: z.enum(["award", "revoke"]),
  reason: z.string().trim().max(300).nullable().optional(),
});

/** POST — beri atau cabut badge secara manual. */
export const POST = crmRoute(MEMBER_LOYALTY_WRITE_MENUS, "Gagal mengubah badge member", async (userId, request: Request, { params }: Ctx) => {
  const customerId = await resolveCustomerId((await params).id);
  if (!customerId) return crmFail("Member tidak ditemukan", 404);
  const body = actionSchema.parse(await request.json());
  if (body.action === "award") {
    const { awarded } = await awardBadgeManually({ customerId, badgeId: body.badge_id, actorId: userId });
    return crmOk({ awarded }, awarded ? "Badge diberikan" : "Member sudah memiliki badge ini");
  }
  const { revoked } = await revokeBadge({
    customerId,
    badgeId: body.badge_id,
    actorId: userId,
    reason: body.reason || null,
  });
  return crmOk({ revoked }, "Badge dicabut");
});
