import type {
  BandFilters,
  BandListResponse,
  CapacityDate,
  CapacityDateFormValues,
  EmployeeOption,
  SettingsFormValues,
  StaffPass,
  TicketBand,
  TimeSlot,
  TimeSlotFormValues,
  TicketChannel,
  TicketingSettings,
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

async function sendJson<T>(
  url: string,
  method: "POST" | "PATCH" | "PUT",
  payload: unknown,
  fallback: string
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) await parseError(res, fallback);
  const body = (await res.json()) as { data: T };
  return body.data;
}

// ── Settings (GET men-bootstrap kanal default venue) ──
export const fetchSettings = () =>
  getJson<TicketingSettings>("/api/ticketing/settings", "Gagal memuat pengaturan");

export const updateSettings = (values: SettingsFormValues) =>
  sendJson<TicketingSettings>(
    "/api/ticketing/settings",
    "PUT",
    values,
    "Gagal menyimpan pengaturan"
  );

// ── Kapasitas harian (EPIC-031) ──
export const fetchCapacityDates = () =>
  getJson<CapacityDate[]>(
    "/api/ticketing/capacity-dates",
    "Gagal memuat override kapasitas"
  );

export const createCapacityDate = (values: CapacityDateFormValues) =>
  sendJson<CapacityDate>(
    "/api/ticketing/capacity-dates",
    "POST",
    values,
    "Gagal menambah override kapasitas"
  );

export const updateCapacityDate = (
  id: string,
  values: Partial<CapacityDateFormValues> & { is_active?: boolean }
) =>
  sendJson<CapacityDate>(
    `/api/ticketing/capacity-dates/${id}`,
    "PATCH",
    values,
    "Gagal memperbarui override kapasitas"
  );

export async function deleteCapacityDate(id: string): Promise<{ id: string }> {
  const res = await fetch(`/api/ticketing/capacity-dates/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) await parseError(res, "Gagal menghapus override kapasitas");
  const body = (await res.json()) as { data: { id: string } };
  return body.data;
}

// EPIC-031 C — okupansi 90 hari ke depan utk peringatan pengaturan kapasitas
export interface OccupancyDayLite {
  date: string;
  online: number;
  walk_in: number;
  capacity: number | null;
}

export const fetchOccupancyRange = (from: string, to: string) =>
  getJson<{ days: OccupancyDayLite[] }>(
    `/api/ticketing/occupancy?from=${from}&to=${to}`,
    "Gagal memuat okupansi"
  ).then((data) => data.days);

// ── Slot waktu timed-entry (EPIC-031 D) ──
export const fetchTimeSlots = () =>
  getJson<TimeSlot[]>("/api/ticketing/time-slots", "Gagal memuat slot waktu");

export const createTimeSlot = (values: TimeSlotFormValues) =>
  sendJson<TimeSlot>(
    "/api/ticketing/time-slots",
    "POST",
    values,
    "Gagal menambah slot waktu"
  );

export const updateTimeSlot = (
  id: string,
  values: Partial<TimeSlotFormValues> & { is_active?: boolean }
) =>
  sendJson<TimeSlot>(
    `/api/ticketing/time-slots/${id}`,
    "PATCH",
    values,
    "Gagal memperbarui slot waktu"
  );

export async function deleteTimeSlot(id: string): Promise<{ id: string }> {
  const res = await fetch(`/api/ticketing/time-slots/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) await parseError(res, "Gagal menghapus slot waktu");
  const body = (await res.json()) as { data: { id: string } };
  return body.data;
}

// ── Kanal ──
export const fetchChannels = () =>
  getJson<TicketChannel[]>("/api/ticketing/channels", "Gagal memuat kanal");

export const updateChannel = (
  id: string,
  values: { name?: string; is_active?: boolean }
) =>
  sendJson<TicketChannel>(
    `/api/ticketing/channels/${id}`,
    "PATCH",
    values,
    "Gagal memperbarui kanal"
  );

// ── Registry gelang ──
export async function fetchBands(filters: BandFilters): Promise<BandListResponse> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  params.set("page", String(filters.page));
  params.set("limit", "20");

  const res = await fetch(`/api/ticketing/bands?${params.toString()}`);
  if (!res.ok) await parseError(res, "Gagal memuat registry gelang");
  return res.json();
}

export const registerBand = (values: { nfc_uid: string; label: string | null }) =>
  sendJson<TicketBand>("/api/ticketing/bands", "POST", values, "Gagal mendaftarkan gelang");

export const updateBand = (
  id: string,
  values: { label?: string | null; status?: TicketBand["status"] }
) =>
  sendJson<TicketBand>(
    `/api/ticketing/bands/${id}`,
    "PATCH",
    values,
    "Gagal memperbarui gelang"
  );

// ── Gelang karyawan (staff pass, Fase E) ──
export const fetchStaffPasses = (q: string) =>
  getJson<StaffPass[]>(
    `/api/ticketing/staff-passes${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    "Gagal memuat gelang karyawan"
  );

export const pairStaffPass = (values: { nfc_uid: string; employee_id: string }) =>
  sendJson<{ id: string }>(
    "/api/ticketing/staff-passes",
    "POST",
    values,
    "Gagal memasangkan gelang karyawan"
  );

export async function revokeStaffPass(id: string): Promise<{ id: string }> {
  const res = await fetch(`/api/ticketing/staff-passes/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) await parseError(res, "Gagal mencabut pairing");
  const body = (await res.json()) as { data: { id: string } };
  return body.data;
}

/** Picker karyawan aktif — numpang API HRIS existing. */
export async function searchEmployees(search: string): Promise<EmployeeOption[]> {
  const params = new URLSearchParams({ is_active: "true", limit: "20" });
  if (search) params.set("search", search);
  const res = await fetch(`/api/hris/employees?${params.toString()}`);
  if (!res.ok) await parseError(res, "Gagal memuat daftar karyawan");
  const body = (await res.json()) as { data: EmployeeOption[] };
  return body.data ?? [];
}
