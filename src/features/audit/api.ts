export interface AuditRow {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  entity_label: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
}

export interface AuditLogResponse {
  data: AuditRow[];
  actors: { actor_id: string; actor_name: string | null }[];
  meta: { total: number; totalPages: number };
}

export interface AuditLogFilters {
  page: number;
  actorId: string;
  entity: string | null;
  action: string | null;
  search: string;
  dateFrom: string;
  dateTo: string;
}

export function auditLogSearchParams(filters: AuditLogFilters): string {
  const params = new URLSearchParams({
    page: String(filters.page),
    limit: "30",
  });
  if (filters.actorId) params.set("actor_id", filters.actorId);
  if (filters.entity) params.set("entity", filters.entity);
  if (filters.action) params.set("action", filters.action);
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  return params.toString();
}

export async function fetchAuditLog(query: string): Promise<AuditLogResponse> {
  const res = await fetch(`/api/audit?${query}`);
  const body = (await res.json().catch(() => ({}))) as Partial<AuditLogResponse> & {
    message?: string;
    error?: string;
  };
  if (!res.ok) throw new Error(body.message || body.error || "Gagal memuat audit");
  return body as AuditLogResponse;
}
