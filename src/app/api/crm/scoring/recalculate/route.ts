import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmScope } from "@/lib/crm/guards";
import { recalculateAllLeadScores } from "@/lib/crm/scoring-server";

/** Hitung ulang skor semua lead (setelah aturan diubah). */
export const POST = apiHandler(async () => {
  const { scope } = await requireCrmScope("settings");
  const result = await recalculateAllLeadScores(scope?.companyId ?? null);
  return successResponse(result, `${result.total} lead dihitung ulang, ${result.changed} berubah`);
}, "crm.scoring.recalculate.POST");
