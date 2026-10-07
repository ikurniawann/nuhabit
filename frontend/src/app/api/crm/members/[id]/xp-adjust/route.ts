import { z } from "zod";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createPgClient } from "@/lib/pg/create-client";
import { parseCrmInput, requireCrmUser } from "@/lib/crm/guards";
import { adjustMemberXp } from "@/lib/crm/loyalty-engine";
import { requireMemberCustomerId } from "@/lib/crm/member-detail-server";
import { getCrmDefaultVenue } from "@/lib/crm/server";

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
export const POST = apiHandler(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireCrmUser("memberLoyaltyWrite");
  const customerId = await requireMemberCustomerId((await params).id);
  const body = parseCrmInput(adjustSchema, await request.json());
  const db = createPgClient();
  const venue = await getCrmDefaultVenue(db);
  const result = await adjustMemberXp(db, {
    customerId,
    delta: body.delta,
    reason: body.reason,
    actorId: user.id,
    requestId: body.request_id,
    companyId: venue.companyId,
    branchId: venue.branchId,
  });
  if (result.status === "skipped") throw ApiError.conflict("XP member sudah 0, tidak ada yang dikurangi");
  return successResponse(
    result,
    result.status === "duplicate" ? "Penyesuaian ini sudah tercatat" : "XP member disesuaikan"
  );
}, "crm.members.[id].xp-adjust.POST");
