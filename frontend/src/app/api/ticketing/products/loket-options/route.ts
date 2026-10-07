import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { loadLoketOptions } from "@/lib/ticketing/product-sales-server";
import { ticketingContext } from "@/lib/ticketing/server";

export const GET = apiHandler(async () => {
  const ctx = await ticketingContext(IAM.ticketingOperator);
  return successResponse(await loadLoketOptions(ctx));
}, "ticketing.products.loket-options.GET");
