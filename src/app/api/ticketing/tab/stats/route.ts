import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { ticketingContext } from "@/lib/ticketing/server";
import { loadTabStats } from "@/lib/ticketing/visits-server";

/** Tab monitor live: ringkasan kunjungan berjalan untuk halaman loket. */
export const GET = apiHandler(async () => {
  const ctx = await ticketingContext(IAM.ticketingOperator);
  return successResponse(await loadTabStats(ctx));
}, "ticketing.tab.stats.GET");
