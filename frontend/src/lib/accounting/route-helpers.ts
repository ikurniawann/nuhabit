import { ApiError } from "@/lib/api/auth";
import { isRowInBusinessScope, type UserScope } from "@/lib/api/scope";

/**
 * Guard record ber-company untuk route accounting: 404 bila tidak ada, 403 bila
 * company-nya di luar scope user. `global` diisi untuk mutasi: record global
 * (company_id null) hanya boleh diubah user unscoped.
 */
export function assertRecordInScope<T extends { company_id: string | null }>(
  record: T | null,
  scope: UserScope | null,
  messages: { notFound: string; outOfScope: string; global?: string }
): T {
  if (!record) throw ApiError.notFound(messages.notFound);
  if (messages.global && record.company_id == null && scope && !scope.isUnscoped) {
    throw ApiError.forbidden(messages.global);
  }
  if (record.company_id != null && !isRowInBusinessScope(scope, record)) {
    throw ApiError.forbidden(messages.outOfScope);
  }
  return record;
}

/** Untuk `.catch()`: unique violation (23505) jadi 400 dengan pesan domain. */
export function rethrowUniqueViolation(message: string) {
  return (error: unknown): never => {
    if ((error as { code?: unknown } | null)?.code === "23505") {
      throw ApiError.badRequest(message);
    }
    throw error;
  };
}

/** Filter + paginasi standar untuk daftar invoice AP/AR dari query string. */
export function parseInvoiceListQuery(sp: URLSearchParams) {
  return {
    status: sp.get("status") || undefined,
    paymentStatus: sp.get("payment_status") || undefined,
    search: sp.get("search") || undefined,
    limit: Number(sp.get("limit") || 20),
    offset: Number(sp.get("offset") || 0),
  };
}
