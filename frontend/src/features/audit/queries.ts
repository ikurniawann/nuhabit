"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { auditLogSearchParams, fetchAuditLog, type AuditLogFilters } from "./api";

export function useAuditLog(filters: AuditLogFilters) {
  const query = auditLogSearchParams(filters);
  return useQuery({
    queryKey: ["audit-log", query],
    queryFn: () => fetchAuditLog(query),
    placeholderData: keepPreviousData,
  });
}
