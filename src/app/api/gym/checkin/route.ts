import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getPool, withTransaction } from "@/lib/db";
import { scanGymQr } from "@/lib/gym/booking-server";
import { loadAccessLog } from "@/lib/gym/session-queries";
import { ok, parseBody } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

/** GET: 100 scan gym terakhir + ringkasan hari ini (WIB). */
export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.gymCheckin);
  return ok(await loadAccessLog(getPool()));
}, "gym.checkin.GET");

const scanSchema = z.object({ token: z.string().trim().min(8).max(120), branch_id: z.string().uuid().nullable().optional() });

/** POST {token}: scan QR member di gate/front desk: check-in kelas + potong kredit, atau alasan ditolak. */
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.gymCheckin);
  const input = await parseBody(request, scanSchema);
  const result = await withTransaction((client) =>
    scanGymQr(client, { token: input.token, branchId: input.branch_id ?? null, scannedBy: user.id })
  );
  return ok(result);
}, "gym.checkin.POST");
