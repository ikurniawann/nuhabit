import { z } from "zod";
import { IAM } from "@/lib/iam/prefixes";
import { crmFail, crmOk, crmRoute } from "@/lib/crm/crm-route";
import { findMemberForSubject, rematchPendingEvents, settleEvent } from "@/lib/crm/partners-server";

const rematchSchema = z.discriminatedUnion("mode", [
  /** Manual: arahkan satu event ke member (dicari lewat telepon/email). */
  z.object({ mode: z.literal("manual"), event_id: z.string().uuid(), identifier: z.string().trim().min(5).max(200) }),
  /** Otomatis: jalankan ulang pencocokan untuk event yang tertunda. */
  z.object({ mode: z.literal("auto"), partner_id: z.string().uuid().nullable().optional() }),
]);

/**
 * POST — cocokkan ulang event. Payload partner tidak diubah; hanya sisi
 * pencocokan kita. XP diberikan bila partner aktif dan memberi XP.
 */
export const POST = crmRoute(IAM.crmPartners, "Gagal mencocokkan ulang event", async (userId, request: Request) => {
  const body = rematchSchema.parse(await request.json());
  if (body.mode === "manual") {
    const customerId = await findMemberForSubject(body.identifier);
    if (!customerId) return crmFail("Member dengan telepon/email itu tidak ditemukan (atau lebih dari satu)", 404);
    const event = await settleEvent(body.event_id, { customerId, actorId: userId });
    if (!event) return crmFail("Event tidak ditemukan", 404);
    return crmOk(event, "Event dicocokkan ke member");
  }
  const result = await rematchPendingEvents(body.partner_id ?? null);
  return crmOk(result, `${result.matched} dari ${result.checked} event berhasil dicocokkan`);
});
