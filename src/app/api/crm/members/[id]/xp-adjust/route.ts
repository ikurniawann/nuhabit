import { z } from "zod";
import { createPgClient } from "@/lib/pg/create-client";
import { crmFail, crmOk, crmRoute } from "@/lib/crm/crm-route";
import { adjustMemberXp } from "@/lib/crm/loyalty-engine";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import { MEMBER_LOYALTY_WRITE_MENUS, resolveCustomerId } from "@/lib/crm/member-detail-server";

const adjustSchema = z.object({
  delta: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((n) => n !== 0, "Jumlah XP tidak boleh 0"),
  reason: z.string().trim().min(5, "Alasan minimal 5 karakter").max(300),
  /** Id unik per pengajuan dari klien: klik ganda tidak menggandakan XP. */
  request_id: z.string().uuid(),
});

/** POST — tambah/kurangi XP member dengan alasan (tercatat di ledger XP). */
export const POST = crmRoute(
  MEMBER_LOYALTY_WRITE_MENUS,
  "Gagal menyesuaikan XP",
  async (userId, request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const customerId = await resolveCustomerId((await params).id);
    if (!customerId) return crmFail("Member tidak ditemukan", 404);
    const body = adjustSchema.parse(await request.json());
    const db = createPgClient();
    const venue = await getCrmDefaultVenue(db);
    const result = await adjustMemberXp(db, {
      customerId,
      delta: body.delta,
      reason: body.reason,
      actorId: userId,
      requestId: body.request_id,
      companyId: venue.companyId,
      branchId: venue.branchId,
    });
    if (result.status === "skipped") return crmFail("XP member sudah 0, tidak ada yang dikurangi", 409);
    return crmOk(
      result,
      result.status === "duplicate" ? "Penyesuaian ini sudah tercatat" : "XP member disesuaikan"
    );
  }
);
