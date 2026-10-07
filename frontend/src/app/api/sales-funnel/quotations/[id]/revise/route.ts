import { NextRequest } from "next/server";
import { createdResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireAccessibleQuotation, reviseQuotation } from "@/lib/sales-funnel/quotations-server";
import { requireSalesFunnelUser } from "@/lib/sales-funnel/server";

type Params = { params: Promise<{ id: string }> };

/** EPIC-050 T-3.4 — buat versi baru quotation (draft v+1); versi lama jadi riwayat. */
export const POST = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const user = await requireSalesFunnelUser();
  const { id } = await params;
  const { row, deal } = await requireAccessibleQuotation(id, user);
  const revision = await reviseQuotation(user, deal, row);
  return createdResponse(revision, `Revisi v${revision.version} dibuat`);
}, "sales-funnel.quotations.revise.POST");
