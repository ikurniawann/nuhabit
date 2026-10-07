import { getSessionToken } from "./session";

/**
 * API client portal member (EPIC-044 Fase A).
 *
 * Semua panggilan ke `/api/member-portal/*` lewat sini supaya:
 * - base URL terpusat di EXPO_PUBLIC_API_URL (dev: localhost:3459 / tunnel);
 * - token Bearer otomatis ditempel bila sesi ada;
 * - bentuk jawaban dinormalisasi: { ok, status, data | error }.
 */

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3459";

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<ApiResult<T>> {
  const token = await getSessionToken();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
    const body = (await res.json().catch(() => null)) as
      | { success: boolean; data?: T; error?: string }
      | null;

    if (!res.ok || !body?.success) {
      return {
        ok: false,
        status: res.status,
        error: body?.error ?? `Permintaan gagal (${res.status})`,
      };
    }
    return { ok: true, status: res.status, data: body.data };
  } catch {
    return {
      ok: false,
      status: 0,
      error: "Tidak bisa menghubungi server — periksa koneksi",
    };
  }
}

export interface MemberProfileResponse {
  profile: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    birth_date: string | null;
    gender: string | null;
    city: string | null;
    photo_url: string | null;
  };
  member_type: string | null;
  ark_coin_balance: number;
  /** Rupiah per 1 ARK — konversi tampilan (lihat lib/loyalty.ts). */
  ark_rate?: number;
  total_xp: number;
  visit_count: number;
  tier: { code: string; name: string; discount_percent: number } | null;
  next_tier: {
    name: string;
    min_lifetime_xp: number;
    xp_needed: number;
  } | null;
  tiers?: Array<{
    code: string;
    name: string;
    min_lifetime_xp: number;
    discount_percent: number;
  }>;
}

interface TransactionsResponse {
  wallet: Array<{
    id: string;
    type: string;
    amount: number;
    balance_after?: number;
    notes: string | null;
    created_at: string;
  }>;
  orders: Array<{
    id: string;
    order_number: string;
    total_amount: number;
    payment_method: string | null;
    status?: string | null;
    created_at: string;
  }>;
}

/** POST /api/member-portal/otp — minta kode OTP via WhatsApp. */
export function requestOtp(phone: string): Promise<ApiResult<unknown>> {
  return request("/api/member-portal/otp", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

/**
 * POST /api/member-portal/verify — verifikasi kode OTP.
 * Header x-app-client membuat server menyertakan `token` sesi di body
 * untuk disimpan di SecureStore (lihat lib/session.ts).
 */
export async function verifyOtp(
  phone: string,
  code: string
): Promise<ApiResult<{ name: string | null; token?: string }>> {
  const result = await request<{ name: string | null; token?: string }>(
    "/api/member-portal/verify",
    {
      method: "POST",
      body: JSON.stringify({ phone, code }),
      headers: { "x-app-client": "1" },
    }
  );
  return result;
}

/** GET /api/member-portal/me — profil + saldo + XP + tier. */
export function fetchMe(): Promise<ApiResult<MemberProfileResponse>> {
  return request<MemberProfileResponse>("/api/member-portal/me");
}

/** GET /api/member-portal/transactions — riwayat wallet + order milik sendiri. */
export function fetchTransactions(): Promise<ApiResult<TransactionsResponse>> {
  return request<TransactionsResponse>("/api/member-portal/transactions");
}

/** POST /api/member-portal/logout — matikan sesi di server. */
export function logoutRequest(): Promise<ApiResult<unknown>> {
  return request("/api/member-portal/logout", { method: "POST" });
}

/**
 * Normalisasi nomor HP sebelum dikirim: server toleran 08xx/62xx, tapi UI
 * tetap merapikan spasi/dash agar pesan error tidak mengejutkan.
 */
export function normalizePhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  return digits;
}
