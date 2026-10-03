import { z } from "zod";
import { fail, gymAdminRoute, ok } from "@/lib/gym/credits-admin-route";
import { validateGymRules, validateGymRulesPatch } from "@/lib/gym/rules";
import { loadGymRulesAdmin, saveGymRules } from "@/lib/gym/rules-server";
import { IAM } from "@/lib/iam/prefixes";

const putSchema = z.object({
  branch_id: z.string().uuid().nullable().default(null),
  rules: z.record(z.string(), z.unknown()),
});

/** GET — default, aturan global efektif, dan override tiap cabang. */
export const GET = gymAdminRoute(IAM.gymRules, "Gagal memuat aturan gym", async () => ok(await loadGymRulesAdmin()));

/**
 * PUT { branch_id: null, rules } — simpan aturan global lengkap.
 * PUT { branch_id, rules } — simpan override cabang (hanya kunci yang berbeda; {} = ikut global).
 */
export const PUT = gymAdminRoute(IAM.gymRules, "Gagal menyimpan aturan gym", async (user, request: Request) => {
  const body = putSchema.parse(await request.json());
  const result = body.branch_id ? validateGymRulesPatch(body.rules) : validateGymRules(body.rules);
  if (!result.ok) return fail(result.error);
  await saveGymRules(body.branch_id, result.rules, user.id);
  return ok(await loadGymRulesAdmin());
});
