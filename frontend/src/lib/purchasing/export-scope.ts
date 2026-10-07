/** Bagian bersama ekspor master purchasing (.xlsx). */
import { NextResponse } from "next/server";
import { branchScopeOr, companyScopeOr, type UserScope } from "@/lib/api/scope";

/**
 * Filter SQL company/branch user (sama ketatnya dengan `companyScopeOr` /
 * `branchScopeOr`) untuk tabel ber-alias `alias`. `params` siap ditambah lagi.
 */
export function scopeSqlFilters(
  scope: UserScope | null,
  alias: string
): { filters: string[]; params: unknown[] } {
  const filters = [`${alias}.deleted_at IS NULL`];
  const params: unknown[] = [];

  if (companyScopeOr(scope) && scope?.companyId) {
    params.push(scope.companyId);
    filters.push(`${alias}.company_id = $${params.length}`);
  }
  if (branchScopeOr(scope) && scope?.branchId) {
    params.push(scope.branchId);
    filters.push(`${alias}.branch_id = $${params.length}`);
  }
  return { filters, params };
}

/** Unduhan `<baseName>-YYYY-MM-DD.xlsx`. */
export function xlsxDownload(buffer: Buffer, baseName: string): NextResponse {
  const date = new Date().toISOString().split("T")[0];
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${baseName}-${date}.xlsx"`,
    },
  });
}
