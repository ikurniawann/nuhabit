import { escapeHtml } from "@/lib/security/escape-html";
import type { DashboardSummary, FunnelDatum } from "./types";

/**
 * Builder export dashboard rekrutmen. Nama, posisi, dan outlet kandidat
 * berasal dari form karir publik, jadi setiap nilai di-escape sebelum masuk
 * HTML jendela print (document.write) atau sel CSV.
 */

export interface AttentionRow {
  full_name?: string | null;
  position_title?: string | null;
  brand_name?: string | null;
  status?: string | null;
  days_in_current_status?: number | null;
}

export function buildRecruitmentReportHtml(input: {
  periodLabel: string;
  summary: DashboardSummary;
  pipelineFunnel: FunnelDatum[];
  needsAttention: AttentionRow[];
}): string {
  const { summary } = input;
  const funnelRows = input.pipelineFunnel
    .map((s) => `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.value)}</td></tr>`)
    .join("");
  const attentionRows = input.needsAttention
    .map(
      (a) =>
        `<tr><td>${escapeHtml(a.full_name)}</td><td>${escapeHtml(a.position_title)}</td>` +
        `<td>${escapeHtml(a.brand_name)}</td><td>${escapeHtml(a.status)}</td>` +
        `<td>${escapeHtml(Number(a.days_in_current_status) || 0)} hari</td></tr>`
    )
    .join("");

  return `
      <html><head><title>Laporan Rekrutmen</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { color: #1e40af; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #f3f4f6; }
        .summary { display: flex; gap: 20px; margin: 20px 0; }
        .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; flex: 1; }
        .card h3 { margin: 0; font-size: 12px; color: #6b7280; }
        .card p { margin: 4px 0 0; font-size: 24px; font-weight: bold; }
      </style></head><body>
      <h1>Laporan Rekrutmen - ${escapeHtml(input.periodLabel)}</h1>
      <div class="summary">
        <div class="card"><h3>Kandidat Bulan Ini</h3><p>${escapeHtml(summary.thisMonth)}</p></div>
        <div class="card"><h3>Pipeline Aktif</h3><p>${escapeHtml(summary.activePipeline)}</p></div>
        <div class="card"><h3>Talent Pool</h3><p>${escapeHtml(summary.talentPool)}</p></div>
        <div class="card"><h3>Lowongan Terbuka</h3><p>${escapeHtml(summary.openPositions)}</p></div>
      </div>
      <h2>Pipeline Funnel</h2>
      <table>
        <tr><th>Stage</th><th>Jumlah</th></tr>
        ${funnelRows}
      </table>
      <h2>Kandidat Butuh Perhatian</h2>
      <table>
        <tr><th>Nama</th><th>Posisi</th><th>Brand</th><th>Status</th><th>Lama di Status</th></tr>
        ${attentionRows}
      </table>
      </body></html>
    `;
}

/**
 * Sel CSV: kutip ganda di-escape, dan nilai yang diawali = + - @ (atau
 * tab/CR) diberi awalan ' supaya spreadsheet tidak menjalankannya sebagai
 * formula.
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
