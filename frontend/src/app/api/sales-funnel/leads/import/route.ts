import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { importLeads } from "@/lib/sales-funnel/lead-import";
import { requireSalesFunnelUser, requireSalesScope, requireSalesVenue } from "@/lib/sales-funnel/server";

/**
 * Import leads CSV/XLSX. Galat juga membawa `message` karena CsvImporter
 * membaca `result.message`.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  try {
    const scope = await requireSalesScope(user);
    const venue = await requireSalesVenue(scope, "Venue belum dikonfigurasi (default_company_id/default_branch_id)");
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) throw ApiError.badRequest("File not found");
    const result = await importLeads(user, venue, {
      buffer: Buffer.from(await file.arrayBuffer()),
      name: file.name,
    });
    return NextResponse.json({ success: true, ...result, updated: 0 });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return NextResponse.json(
      { success: false, error: error.message, message: error.message },
      { status: error.status }
    );
  }
}, "sales-funnel.leads.import.POST");
