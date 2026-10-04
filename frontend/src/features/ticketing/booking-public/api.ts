// Fetcher endpoint publik booking & season pass (tanpa login). Semua gagal
// dilempar sebagai PublicApiError supaya UI bisa membedakan status
// (404 = tidak ditemukan, 409 = keburu penuh, 422 = promo ditolak).

import type { BookingCreatePayload } from "@/lib/ticketing/booking-wizard-cart";
import type {
  BookingCatalog,
  BookingStatusData,
  CheckoutRedirect,
  PassCatalog,
  PassProduct,
  PassPurchaseInput,
  PassStatus,
  PromoCheckInput,
  PromoCheckResult,
  TimeSlot,
} from "./types";

export class PublicApiError extends Error {
  /** HTTP status; 0 = gagal jaringan. */
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const NETWORK_ERROR = "Jaringan bermasalah — coba lagi";

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

async function request<T>(
  url: string,
  init: RequestInit | undefined,
  fallback: string | ((status: number) => string),
  networkError = NETWORK_ERROR
): Promise<T> {
  let res: Response;
  let body: Envelope<T> | null;
  try {
    res = await fetch(url, init);
    body = (await res.json().catch(() => null)) as Envelope<T> | null;
  } catch {
    throw new PublicApiError(networkError, 0);
  }
  if (!res.ok || !body?.success) {
    const message = typeof fallback === "function" ? fallback(res.status) : fallback;
    throw new PublicApiError(body?.error ?? message, res.status);
  }
  return body.data as T;
}

const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function fetchBookingCatalog(slug: string, date: string): Promise<BookingCatalog> {
  const data = await request<{ venue?: { name?: string }; products: BookingCatalog["products"] }>(
    `/api/public/booking/${slug}/catalog?date=${date}`,
    undefined,
    (status) =>
      status === 404 ? "Halaman booking tidak ditemukan" : "Gagal memuat tiket — coba lagi"
  );
  return { venueName: data.venue?.name ?? "", products: data.products };
}

export const fetchBookingAvailability = async (slug: string, from: string, to: string) =>
  (
    await request<{ dates?: Record<string, "sold_out" | "closed"> }>(
      `/api/public/booking/${slug}/availability?from=${from}&to=${to}`,
      undefined,
      "Gagal memuat ketersediaan"
    )
  ).dates ?? {};

export const fetchBookingSlots = async (slug: string, date: string) =>
  (
    await request<{ slots?: TimeSlot[] }>(
      `/api/public/booking/${slug}/slots?date=${date}`,
      undefined,
      "Gagal memuat slot waktu"
    )
  ).slots ?? [];

export const checkPromoCode = (slug: string, input: PromoCheckInput) =>
  request<PromoCheckResult>(
    `/api/public/booking/${slug}/promo-check`,
    postJson(input),
    "Gagal memeriksa kode — coba lagi"
  );

export const createBooking = (slug: string, payload: BookingCreatePayload) =>
  request<CheckoutRedirect>(
    `/api/public/booking/${slug}`,
    postJson(payload),
    "Gagal membuat booking — coba lagi",
    "Jaringan bermasalah — booking belum dibuat, coba lagi"
  );

export const fetchBookingStatus = (token: string) =>
  request<BookingStatusData>(
    `/api/public/booking/status/${token}`,
    { cache: "no-store" },
    "Booking tidak ditemukan"
  );

export async function fetchPassCatalog(slug: string): Promise<PassCatalog> {
  const data = await request<{ venue?: { name?: string }; passes?: PassProduct[] }>(
    `/api/public/booking/${slug}/passes`,
    undefined,
    "Gagal memuat pass"
  );
  return { venueName: data.venue?.name ?? "", passes: data.passes ?? [] };
}

export const createPass = (slug: string, input: PassPurchaseInput) =>
  request<CheckoutRedirect>(
    `/api/public/booking/${slug}/pass`,
    postJson(input),
    "Gagal membuat pass — coba lagi",
    "Jaringan bermasalah — pass belum dibuat, coba lagi"
  );

export const fetchPassStatus = (token: string) =>
  request<PassStatus>(`/api/public/booking/pass-status/${token}`, undefined, "Pass tidak ditemukan");
