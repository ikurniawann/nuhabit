import { z } from "zod";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { parseCrmInput, requireCrmUser } from "@/lib/crm/guards";
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
export const POST = apiHandler(async (request: Request) => {
  const user = await requireCrmUser("partners");
  const body = parseCrmInput(rematchSchema, await request.json());
  if (body.mode === "manual") {
    const customerId = await findMemberForSubject(body.identifier);
    if (!customerId) throw ApiError.notFound("Member dengan telepon/email itu tidak ditemukan (atau lebih dari satu)");
    const event = await settleEvent(body.event_id, { customerId, actorId: user.id });
    if (!event) throw ApiError.notFound("Event tidak ditemukan");
    return successResponse(event, "Event dicocokkan ke member");
  }
  const result = await rematchPendingEvents(body.partner_id ?? null);
  return successResponse(result, `${result.matched} dari ${result.checked} event berhasil dicocokkan`);
}, "crm.partners.events.rematch.POST");
