import type {
  BookingDetail,
  BookingFilters,
  BookingListResponse,
  BookingLookup,
  OccupancyDay,
  RedeemBand,
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
  method: "POST" | "PATCH",
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

export const lookupBooking = (code: string) =>
  getJson<BookingLookup>(
    `/api/ticketing/bookings/lookup?code=${encodeURIComponent(code)}`,
    "Gagal mencari booking"
  );

export const redeemBooking = (id: string, bands: RedeemBand[]) =>
  sendJson<{ visit_id: string }>(
    `/api/ticketing/bookings/${id}/redeem`,
    "POST",
    { bands },
    "Gagal me-redeem booking"
  );

export const fetchBookings = async (
  filters: BookingFilters
): Promise<BookingListResponse> => {
  const params = new URLSearchParams({ page: String(filters.page) });
  if (filters.date) params.set("date", filters.date);
  if (filters.status) params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  const res = await fetch(`/api/ticketing/bookings?${params.toString()}`);
  if (!res.ok) await parseError(res, "Gagal memuat daftar booking");
  return (await res.json()) as BookingListResponse;
};

export const fetchBookingDetail = (id: string) =>
  getJson<BookingDetail>(
    `/api/ticketing/bookings/${id}`,
    "Gagal memuat rincian booking"
  );

export const cancelBooking = (id: string, refundNote: string | null) =>
  sendJson<{ id: string }>(
    `/api/ticketing/bookings/${id}/cancel`,
    "POST",
    { refund_note: refundNote },
    "Gagal membatalkan booking"
  );

export const saveRefundNote = (id: string, refundNote: string) =>
  sendJson<{ id: string }>(
    `/api/ticketing/bookings/${id}`,
    "PATCH",
    { refund_note: refundNote },
    "Gagal menyimpan catatan refund"
  );

export const clearWebhookAlert = (id: string) =>
  sendJson<{ id: string }>(
    `/api/ticketing/bookings/${id}`,
    "PATCH",
    { clear_webhook_alert: true },
    "Gagal menandai alert selesai"
  );

export const resendBookingWa = (id: string) =>
  sendJson<{ booking_code: string }>(
    `/api/ticketing/bookings/${id}/resend-wa`,
    "POST",
    {},
    "Gagal mengirim ulang WA"
  );

export const fetchOccupancy = (from: string, to: string) =>
  getJson<{ days: OccupancyDay[] }>(
    `/api/ticketing/occupancy?from=${from}&to=${to}`,
    "Gagal memuat okupansi"
  ).then((data) => data.days);
