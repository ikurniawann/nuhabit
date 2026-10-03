import { z } from "zod";
import { withTransaction } from "@/lib/db";
import { gymAdminRoute, ok } from "@/lib/gym/credits-admin-route";
import { reverseCreditEntry } from "@/lib/gym/credits-server";
import { IAM } from "@/lib/iam/prefixes";

const schema = z.object({
  entry_id: z.string().uuid("Entri tidak valid"),
  reason: z.string().trim().min(3, "Alasan pembatalan wajib diisi").max(500),
});

/** POST { entry_id, reason } — tulis entri pembalik. Entri asli tidak pernah diubah. */
export const POST = gymAdminRoute(IAM.gymCredits, "Gagal membatalkan entri", async (user, request: Request) => {
  const body = schema.parse(await request.json());
  const result = await withTransaction((client) =>
    reverseCreditEntry(client, { entryId: body.entry_id, reason: body.reason, actorId: user.id })
  );
  return ok(result);
});
