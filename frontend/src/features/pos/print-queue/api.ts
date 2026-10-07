import type { PrintJob, PrintJobAction, PrintJobListParams } from "./types";

export type * from "./types";

async function parsePosResponse<T>(response: Response, fallbackError: string): Promise<T> {
  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.error || fallbackError);
  }
  return json as T;
}

export async function listPrintJobs(params: PrintJobListParams = {}): Promise<PrintJob[]> {
  const sp = new URLSearchParams();
  sp.set("limit", String(params.limit ?? 100));
  if (params.station && params.station !== "all") sp.set("station", params.station);
  if (params.status && params.status !== "all") sp.set("status", params.status);

  const response = await fetch(`/api/pos/print-jobs?${sp.toString()}`, { cache: "no-store" });
  const json = await parsePosResponse<{ data: PrintJob[] }>(response, "Gagal memuat print queue");
  return json.data ?? [];
}

export async function updatePrintJob(jobId: string, action: PrintJobAction): Promise<void> {
  const response = await fetch(`/api/pos/print-jobs/${jobId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  await parsePosResponse(response, "Gagal update print job");
}
