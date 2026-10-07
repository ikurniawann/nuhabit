import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { withTransaction } from "@/lib/db";
import { reverseCreditEntry } from "@/lib/gym/credits-server";
import { ok, parseBody } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

const schema = z.object({
  entry_id: z.string().uuid("Entri tidak valid"),
  reason: z.string().trim().min(3, "Alasan pembatalan wajib diisi").max(500),
});

/** POST { entry_id, reason }: tulis entri pembalik. Entri asli tidak pernah diubah. */
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.gymCredits);
  const body = await parseBody(request, schema, "issue");
  const result = await withTransaction((client) =>
    reverseCreditEntry(client, { entryId: body.entry_id, reason: body.reason, actorId: user.id })
  );
  return ok(result);
}, "gym.credits.reverse.POST");
