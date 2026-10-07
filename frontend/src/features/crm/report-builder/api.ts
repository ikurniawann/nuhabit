import type { ReportDefinition } from "@/lib/crm/report-builder";
import type {
  DashboardDetail, DashboardRow, ReportRegistry, ReportResult, SavedReport, ScheduleInput, ScheduleRow, WidgetInput,
} from "./types";

async function parseError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = (await res.json()) as { error?: string; message?: string; details?: Array<{ message: string }> };
    message = body.error ?? body.message ?? fallback;
    if (body.details?.length) message += `: ${body.details.map((d) => d.message).join("; ")}`;
  } catch {
    // bukan JSON
  }
  throw new Error(message);
}

async function json<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) await parseError(res, fallback);
  const body = (await res.json()) as { data: T; message?: string };
  return body.data;
}

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

// ── registry & eksekusi ──
export const fetchRegistry = () =>
  fetch("/api/crm/report-builder/datasets").then((r) => json<ReportRegistry>(r, "Gagal memuat daftar dataset"));
export const runDefinition = (definition: ReportDefinition) =>
  fetch("/api/crm/report-builder/run", jsonInit("POST", definition)).then((r) => json<ReportResult>(r, "Gagal menjalankan report"));

// ── report tersimpan ──
export const fetchReports = () => fetch("/api/crm/report-builder").then((r) => json<SavedReport[]>(r, "Gagal memuat report"));
export const runSavedReport = (id: string) =>
  fetch(`/api/crm/report-builder/${id}`).then((r) => json<{ report: SavedReport; result: ReportResult }>(r, "Gagal menjalankan report"));
export const createReport = (v: { name: string; description?: string | null; definition: ReportDefinition; is_shared: boolean }) =>
  fetch("/api/crm/report-builder", jsonInit("POST", v)).then((r) => json(r, "Gagal menyimpan report"));
export const updateReport = (id: string, v: Partial<{ name: string; description: string | null; definition: ReportDefinition; is_shared: boolean }>) =>
  fetch(`/api/crm/report-builder/${id}`, jsonInit("PATCH", v)).then((r) => json(r, "Gagal memperbarui report"));
export const deleteReport = async (id: string) => {
  const r = await fetch(`/api/crm/report-builder/${id}`, { method: "DELETE" });
  if (!r.ok && r.status !== 204) await parseError(r, "Gagal menghapus report");
};

/** Unduh XLSX; nama berkas diambil dari header Content-Disposition bila ada. */
export async function downloadReportXlsx(id: string, fallbackName: string): Promise<void> {
  const res = await fetch(`/api/crm/report-builder/${id}/export`);
  if (!res.ok) await parseError(res, "Gagal mengekspor report");
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = match?.[1] ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── dashboard ──
export const fetchDashboards = () => fetch("/api/crm/dashboards").then((r) => json<DashboardRow[]>(r, "Gagal memuat dashboard"));
export const fetchDashboard = (id: string) => fetch(`/api/crm/dashboards/${id}`).then((r) => json<DashboardDetail>(r, "Gagal memuat dashboard"));
export const createDashboard = (v: { name: string; description?: string | null; is_default: boolean }) =>
  fetch("/api/crm/dashboards", jsonInit("POST", v)).then((r) => json(r, "Gagal membuat dashboard"));
export const updateDashboard = (id: string, v: Partial<{ name: string; description: string | null; is_default: boolean; widgets: WidgetInput[] }>) =>
  fetch(`/api/crm/dashboards/${id}`, jsonInit("PATCH", v)).then((r) => json(r, "Gagal memperbarui dashboard"));
export const deleteDashboard = async (id: string) => {
  const r = await fetch(`/api/crm/dashboards/${id}`, { method: "DELETE" });
  if (!r.ok && r.status !== 204) await parseError(r, "Gagal menghapus dashboard");
};

// ── jadwal ──
export const fetchSchedules = () => fetch("/api/crm/report-schedules").then((r) => json<ScheduleRow[]>(r, "Gagal memuat jadwal"));
export const createSchedule = (v: ScheduleInput) => fetch("/api/crm/report-schedules", jsonInit("POST", v)).then((r) => json(r, "Gagal membuat jadwal"));
export const updateSchedule = (id: string, v: Partial<ScheduleInput>) =>
  fetch(`/api/crm/report-schedules/${id}`, jsonInit("PATCH", v)).then((r) => json(r, "Gagal memperbarui jadwal"));
export const deleteSchedule = async (id: string) => {
  const r = await fetch(`/api/crm/report-schedules/${id}`, { method: "DELETE" });
  if (!r.ok && r.status !== 204) await parseError(r, "Gagal menghapus jadwal");
};
export const runScheduleNow = (id: string) =>
  fetch(`/api/crm/report-schedules/${id}`, jsonInit("POST")).then((r) => json<{ sent: number; rowCount: number }>(r, "Gagal mengirim"));
