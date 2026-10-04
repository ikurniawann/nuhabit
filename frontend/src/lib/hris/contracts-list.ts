/**
 * Parser query param daftar kontrak karyawan (halaman HRIS → Kontrak).
 * Sort di-whitelist (dipakai langsung dalam ORDER BY), angka di-clamp.
 */

export const CONTRACT_SORT_COLUMNS = {
  end_date: "c.end_date",
  start_date: "c.start_date",
  employee_name: "e.full_name",
  contract_number: "c.contract_number",
  created_at: "c.created_at",
} as const;

export type ContractSortKey = keyof typeof CONTRACT_SORT_COLUMNS;

const STATUSES = new Set(["draft", "active", "ended", "terminated", "converted"]);
const TYPES = new Set(["pkwt", "pkwtt"]);

export interface ContractListParams {
  status: string | null;
  contractType: "pkwt" | "pkwtt" | null;
  search: string | null;
  expiringWithin: number | null;
  sortBy: ContractSortKey;
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function parseContractListParams(params: URLSearchParams): ContractListParams {
  const statusRaw = params.get("status") ?? "active";
  const status = statusRaw === "all" ? null : STATUSES.has(statusRaw) ? statusRaw : "active";

  const typeRaw = params.get("type");
  const contractType = typeRaw && TYPES.has(typeRaw) ? (typeRaw as "pkwt" | "pkwtt") : null;

  const search = params.get("search")?.trim() || null;

  const daysRaw = params.get("days");
  const daysNum = daysRaw === null ? NaN : Number(daysRaw);
  const expiringWithin = Number.isFinite(daysNum) ? clamp(Math.trunc(daysNum), 1, 365) : null;

  const sortByRaw = params.get("sort_by") ?? "";
  const sortBy: ContractSortKey =
    sortByRaw in CONTRACT_SORT_COLUMNS ? (sortByRaw as ContractSortKey) : "end_date";
  const sortOrder = params.get("sort_order") === "desc" ? "desc" : "asc";

  const pageNum = Number(params.get("page") ?? 1);
  const limitNum = Number(params.get("limit") ?? 15);

  return {
    status,
    contractType,
    search,
    expiringWithin,
    sortBy,
    sortOrder,
    page: Number.isFinite(pageNum) ? clamp(Math.trunc(pageNum), 1, 100000) : 1,
    limit: Number.isFinite(limitNum) ? clamp(Math.trunc(limitNum), 1, 100) : 15,
  };
}
