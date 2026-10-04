import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { listFinanceInvoices } from "@/lib/finance/invoices";
import { requireFinanceUser } from "@/lib/finance/server";
import { requireSalesScope } from "@/lib/sales-funnel/server";

// EPIC-025 — daftar invoice lintas-deal untuk modul Finance:
// pengajuan sales masuk sini (status 'diajukan'), finance memproses.
export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireFinanceUser();
  const scope = await requireSalesScope(user);
  const sp = request.nextUrl.searchParams;
  const rows = await listFinanceInvoices(scope, {
    status: sp.get("status") ?? "",
    q: sp.get("q")?.trim() ?? "",
  });
  return successResponse(rows);
}, "GET /api/finance/invoices");
