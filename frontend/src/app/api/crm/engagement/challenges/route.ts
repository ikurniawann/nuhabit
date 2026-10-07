import { z } from "zod";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  challengeSchema,
  listChallenges,
  loadChallengeParticipants,
  saveChallenge,
} from "@/lib/crm/engagement/admin-server";
import { parseCrmInput, requireCrmUser } from "@/lib/crm/guards";

/**
 * GET — semua challenge dengan jumlah peserta dan yang sudah selesai.
 * GET ?id= — peserta satu challenge dengan progresnya, tertinggi dulu.
 */
export const GET = apiHandler(async (request: Request) => {
  await requireCrmUser("engagement");
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return successResponse(await listChallenges());
  if (!z.string().uuid().safeParse(id).success) throw ApiError.notFound("Challenge tidak ditemukan");
  return successResponse(await loadChallengeParticipants(id));
}, "crm.engagement.challenges.GET");

/** POST — buat atau ubah challenge. */
export const POST = apiHandler(async (request: Request) => {
  await requireCrmUser("engagement");
  const challenge = parseCrmInput(challengeSchema, await request.json());
  return successResponse(await saveChallenge(challenge));
}, "crm.engagement.challenges.POST");
