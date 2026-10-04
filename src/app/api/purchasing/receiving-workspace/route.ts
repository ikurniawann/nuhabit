import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";
import { parsePurchasingModuleType } from "@/lib/purchasing/module-scope";
import { loadReceivingWorkspace } from "@/lib/purchasing/receiving-workspace";

// GET /api/purchasing/receiving-workspace — PO, delivery dan GRN terbaru per modul.
export const GET = apiHandler(async (request: Request) => {
  await requireIamMenuPrefix(IAM.items);
  const moduleType = parsePurchasingModuleType(new URL(request.url).searchParams.get("module_type"));
  const data = await loadReceivingWorkspace(createPgClient(), moduleType);
  return Response.json({ success: true, data });
}, "purchasing.receiving-workspace");
