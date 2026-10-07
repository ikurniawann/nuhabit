import type {
  AnalyzeBatchResult,
  ConversationInsightReportData,
  CrmReportData,
  CrmReportPeriodInput,
  CsReportData,
} from "./types";

export type * from "./types";

export async function getCrmReports(period: Partial<CrmReportPeriodInput>): Promise<CrmReportData> {
  const params = new URLSearchParams();
  if (period.from) params.set("from", period.from);
  if (period.to) params.set("to", period.to);

  const queryString = params.toString();
  const response = await fetch(`/api/crm/reports${queryString ? `?${queryString}` : ""}`, {
    cache: "no-store",
  });
  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.error || "Gagal memuat laporan CRM");
  }
  return json.data as CrmReportData;
}

export async function getCsReport(
  period: Partial<CrmReportPeriodInput>
): Promise<CsReportData> {
  const sp = new URLSearchParams();
  if (period.from) sp.set("from", period.from);
  if (period.to) sp.set("to", period.to);

  const response = await fetch(`/api/crm/reports/cs?${sp.toString()}`, { cache: "no-store" });
  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.error || "Gagal memuat laporan CS");
  }
  return json.data as CsReportData;
}

/** EPIC-029 — laporan analitik percakapan (agregat, tanpa PII). */
export async function getConversationInsightReport(
  period: Partial<CrmReportPeriodInput>
): Promise<ConversationInsightReportData> {
  const sp = new URLSearchParams();
  if (period.from) sp.set("from", period.from);
  if (period.to) sp.set("to", period.to);

  const response = await fetch(`/api/crm/reports/conversations?${sp.toString()}`, {
    cache: "no-store",
  });
  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.error || "Gagal memuat laporan analitik percakapan");
  }
  return json.data as ConversationInsightReportData;
}

/**
 * Jalankan analisa untuk percakapan yang belum/berubah. Batch-nya dibatasi di
 * server, jadi tombol UI tidak bisa memicu borongan tak terbatas.
 */
export async function analyzePendingConversations(limit?: number): Promise<AnalyzeBatchResult> {
  const response = await fetch("/api/crm/inbox/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ analyze_pending: true, ...(limit ? { limit } : {}) }),
  });
  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.error || "Gagal menganalisa percakapan");
  }
  return json.data as AnalyzeBatchResult;
}

/**
 * Unduh laporan sebagai XLSX. Blob dipakai (bukan window.open) supaya error
 * izin/periode tetap muncul sebagai pesan, bukan tab kosong.
 */
export async function downloadConversationInsightXlsx(
  period: Partial<CrmReportPeriodInput>
): Promise<void> {
  const sp = new URLSearchParams({ format: "xlsx" });
  if (period.from) sp.set("from", period.from);
  if (period.to) sp.set("to", period.to);

  const response = await fetch(`/api/crm/reports/conversations?${sp.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    const message = await response
      .json()
      .then((json) => json.error as string | undefined)
      .catch(() => undefined);
    throw new Error(message || "Gagal mengunduh laporan");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `analitik-percakapan-${period.from ?? ""}_${period.to ?? ""}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
