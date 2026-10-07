import type {
  GateTapResponse,
  RegisterVisitValues,
  SettleValues,
  VisitDetail,
  VisitFilters,
  VisitListResponse,
} from "./types";

async function parseError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    message = body.error ?? body.message ?? fallback;
  } catch {
    // body bukan JSON — pakai fallback
  }
  throw new Error(message);
}

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) await parseError(res, fallback);
  const body = (await res.json()) as { data: T };
  return body.data;
}

async function postJson<T>(
  url: string,
  payload: unknown,
  fallback: string
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) await parseError(res, fallback);
  const body = (await res.json()) as { data: T };
  return body.data;
}

export const fetchVisits = async (
  filters: VisitFilters
): Promise<VisitListResponse> => {
  const params = new URLSearchParams({
    status: filters.status,
    page: String(filters.page),
  });
  if (filters.q) params.set("q", filters.q);
  const res = await fetch(`/api/ticketing/visits?${params.toString()}`);
  if (!res.ok) await parseError(res, "Gagal memuat daftar kunjungan");
  return (await res.json()) as VisitListResponse;
};

export const fetchVisitDetail = (id: string) =>
  getJson<VisitDetail>(
    `/api/ticketing/visits/${id}`,
    "Gagal memuat rincian kunjungan"
  );

export const registerVisit = (values: RegisterVisitValues) =>
  postJson<{ id: string }>(
    "/api/ticketing/visits",
    values,
    "Gagal mendaftarkan kunjungan"
  );

export const topupVisit = (
  id: string,
  values: { amount: number; method: string }
) =>
  postJson<{ id: string }>(
    `/api/ticketing/visits/${id}/deposit`,
    values,
    "Gagal menyimpan top-up"
  );

export const settleVisit = (id: string, values: SettleValues) =>
  postJson<{ mode: string; paid: number; refunded?: number; closed: boolean }>(
    `/api/ticketing/visits/${id}/settle`,
    values,
    "Gagal melakukan settlement"
  );

export const gateTap = (values: { nfc_uid: string; gate_label?: string }) =>
  postJson<GateTapResponse>("/api/ticketing/gate/tap", values, "Gagal memproses tap");

export interface TabStats {
  open_visits: number;
  open_bands: number;
  outstanding_total: number;
  saldo_total: number;
}

export const fetchTabStats = () =>
  getJson<TabStats>("/api/ticketing/tab/stats", "Gagal memuat statistik tab");

export const voidCharge = (visitId: string, chargeId: string, reason: string) =>
  postJson<{ id: string }>(
    `/api/ticketing/visits/${visitId}/charges/${chargeId}/void`,
    { reason },
    "Gagal mem-void tagihan"
  );

export const markBandLost = (visitId: string, visitBandId: string) =>
  postJson<{ visit_band_id: string; nfc_uid: string }>(
    `/api/ticketing/visits/${visitId}/bands/${visitBandId}/lost`,
    {},
    "Gagal menandai gelang hilang"
  );
