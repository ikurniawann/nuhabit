"use client";

import { useQuery } from "@tanstack/react-query";
import { getConversationInsightReport, getCrmReports, getCsReport } from "./api";
import type { CrmReportPeriodInput } from "./types";

export const reportQueryKeys = {
  all: ["crm", "reports"] as const,
  period: (period: Partial<CrmReportPeriodInput>) =>
    [...reportQueryKeys.all, period.from ?? "", period.to ?? ""] as const,
};

export const useCrmReports = (period: Partial<CrmReportPeriodInput>) =>
  useQuery({
    queryKey: reportQueryKeys.period(period),
    queryFn: () => getCrmReports(period),
  });

export const useCsReport = (period: Partial<CrmReportPeriodInput>) =>
  useQuery({
    queryKey: [...reportQueryKeys.all, "cs", period.from ?? "", period.to ?? ""] as const,
    queryFn: () => getCsReport(period),
  });

/** EPIC-029 — laporan analitik percakapan (agregat kata kunci/topik/sentimen). */
export const conversationInsightQueryKey = (period: Partial<CrmReportPeriodInput>) =>
  [...reportQueryKeys.all, "conversation-insights", period.from ?? "", period.to ?? ""] as const;

export const useConversationInsightReport = (period: Partial<CrmReportPeriodInput>) =>
  useQuery({
    queryKey: conversationInsightQueryKey(period),
    queryFn: () => getConversationInsightReport(period),
  });
