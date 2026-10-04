import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { validateGymRules, validateGymRulesPatch } from "@/lib/gym/rules";
import { loadGymRulesAdmin, saveGymRules } from "@/lib/gym/rules-server";
import { ok, parseBody } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

const putSchema = z.object({
  branch_id: z.string().uuid().nullable().default(null),
  rules: z.record(z.string(), z.unknown()),
});

/** GET: default, aturan global efektif, dan override tiap cabang. */
export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.gymRules);
  return ok(await loadGymRulesAdmin());
}, "gym.rules.GET");

/**
 * PUT { branch_id: null, rules }: simpan aturan global lengkap.
 * PUT { branch_id, rules }: simpan override cabang (hanya kunci yang berbeda; {} = ikut global).
 */
export const PUT = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.gymRules);
  const body = await parseBody(request, putSchema, "issue");
  const result = body.branch_id ? validateGymRulesPatch(body.rules) : validateGymRules(body.rules);
  if (!result.ok) throw ApiError.badRequest(result.error);
  await saveGymRules(body.branch_id, result.rules, user.id);
  return ok(await loadGymRulesAdmin());
}, "gym.rules.PUT");
