import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";
import { listWipInventory } from "@/lib/purchasing/production-wip";

// GET /api/purchasing/production/wip
export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.items);
  const { data, summary } = await listWipInventory(createPgClient());
  return NextResponse.json({ success: true, data, summary });
}, "purchasing.production.wip");
