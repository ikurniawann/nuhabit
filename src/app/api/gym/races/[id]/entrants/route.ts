import type { NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { listRaceEntrants } from "@/lib/gym/race-admin-server";
import { ok, requireUuid } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

type Ctx = { params: Promise<{ id: string }> };

/** GET: member yang menargetkan race ini: divisi, target, hasil. */
export const GET = apiHandler(async (_request: NextRequest, ctx: Ctx) => {
  await requireIamMenuPrefix(IAM.gymRaces);
  const id = requireUuid((await ctx.params).id);
  return ok(await listRaceEntrants(id));
}, "gym.races.entrants.GET");
