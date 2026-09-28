/** Klien fetch tipis utk halaman self-order meja (semua endpoint publik/cookie member). */

import type { BillingCharge, ChargeBreakdownLine } from "@/lib/pos/billing-settings";
import type { TableOrderCategory, TableOrderProduct } from "@/lib/table-order/menu";
import type { TableOrderPaymentMethod, TableOrderType } from "@/lib/table-order/order-status";

export type TableSession = {
  table_id: string | null;
  table_code: string;
  table_label: string;
  table_area: string | null;
  table_resolved: boolean;
  status: string;
  brand_name: string;
  billing: { profile: string; charges: BillingCharge[] };
  qris_available: boolean;
  /** Static QRIS (Settings → Payment Gateways): gambar QR statis + unggah bukti bayar. */
  static_qris_available?: boolean;
  static_qris_image_url?: string | null;
  ark_rate: number;
  member_logged_in: boolean;
  /** Saklar CRM → Pengaturan (lib/crm/loyalty-features). Absen = aktif (server lama). */
  ark_enabled?: boolean;
  xp_enabled?: boolean;
};

export type CatalogMeta = {
  total_products: number;
  sellable_products: number;
  hidden_unavailable: number;
};

export type Catalog = {
  products: TableOrderProduct[];
  categories: TableOrderCategory[];
  meta: CatalogMeta;
};

export type MemberProfile = {
  id: string;
  name: string;
  phone: string;
  ark_coin_balance: number;
  ark_rate: number;
  total_xp: number;
  tier: { code: string; name: string; discount_percent: number } | null;
};

export type OrderQris = {
  qr_id: string;
  qr_string: string;
  amount: number;
  expires_at: string | null;
};

export type OrderItem = {
  id?: string;
  product_name: string;
  variant_name: string | null;
  modifier_names?: string[];
  quantity: number;
  unit_price: number;
  total_amount: number;
  station: string | null;
  kitchen_status?: string | null;
};

export type OrderData = {
  id: string;
  order_number: string | null;
  queue_number: string | null;
  status: string;
  payment_status: string;
  payment_flow: string;
  order_type: string | null;
  subtotal: number;
  tax_amount: number;
  service_charge_amount: number;
  other_charges_amount: number;
  total_amount: number;
  breakdown: ChargeBreakdownLine[];
  total_xp: number;
  items: OrderItem[];
  qris: OrderQris | null;
  qris_error?: string | null;
  qris_status?: string | null;
  qris_check_error?: string | null;
  table_code?: string;
  /** Static QRIS: kapan pemesan terakhir mengunggah bukti bayar (null = belum). */
  payment_proof_uploaded_at?: string | null;
};

export type CreateOrderInput = {
  table_code: string;
  order_type: TableOrderType;
  payment_method: TableOrderPaymentMethod;
  items: { product_id: string; variant_id: string | null; modifier_ids?: string[]; quantity: number }[];
  customer_note?: string;
  guest_name?: string;
  /** Wajib bila bukan member login — 628xx. */
  guest_phone?: string;
};

export class ApiRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    data?: T;
  } & Record<string, unknown>;
  if (!response.ok || json.success === false) {
    throw new ApiRequestError(json.error || `Permintaan gagal (${response.status})`, response.status);
  }
  return json as unknown as T;
}

export async function fetchSession(tableCode: string) {
  const json = await request<{ data: TableSession }>(
    `/api/table-order/session/${encodeURIComponent(tableCode)}`
  );
  return json.data;
}

export async function fetchCatalog(): Promise<Catalog> {
  const json = await request<{
    data: TableOrderProduct[];
    categories: TableOrderCategory[];
    meta: CatalogMeta;
  }>("/api/table-order/products");
  return { products: json.data ?? [], categories: json.categories ?? [], meta: json.meta };
}

export async function createOrder(input: CreateOrderInput) {
  const json = await request<{ data: OrderData }>("/api/table-order/orders", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return json.data;
}

export async function fetchOrder(orderId: string, options: { qr?: boolean } = {}) {
  const json = await request<{ data: OrderData }>(
    `/api/table-order/orders/${encodeURIComponent(orderId)}${options.qr ? "?qr=1" : ""}`
  );
  return json.data;
}

/** URL gambar bukti bayar milik order ini (akses = id order acak, sama dgn status). */
export function paymentProofUrl(orderId: string, version?: string | null) {
  const base = `/api/table-order/orders/${encodeURIComponent(orderId)}/payment-proof`;
  return version ? `${base}?v=${encodeURIComponent(version)}` : base;
}

export async function uploadPaymentProof(orderId: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  // Tanpa helper request(): FormData butuh Content-Type multipart dari browser.
  const response = await fetch(paymentProofUrl(orderId), {
    method: "POST",
    body,
    cache: "no-store",
    credentials: "same-origin",
  });
  const json = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    data?: { payment_proof_uploaded_at: string };
  };
  if (!response.ok || json.success === false || !json.data) {
    throw new ApiRequestError(json.error || `Upload gagal (${response.status})`, response.status);
  }
  return json.data;
}

export async function fetchMember(): Promise<MemberProfile | null> {
  try {
    const json = await request<{
      data: {
        profile: { id: string; name: string | null; phone: string | null };
        ark_coin_balance: number;
        ark_rate: number;
        total_xp: number;
        tier: MemberProfile["tier"];
      };
    }>("/api/member-portal/me");
    return {
      id: json.data.profile.id,
      name: json.data.profile.name || "Member",
      phone: json.data.profile.phone || "",
      ark_coin_balance: Number(json.data.ark_coin_balance) || 0,
      ark_rate: Number(json.data.ark_rate) || 1000,
      total_xp: Number(json.data.total_xp) || 0,
      tier: json.data.tier,
    };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return null;
    throw error;
  }
}

/** Coba verify tanpa kode (bypass dev lokal) — server yang memutuskan; gagal = alur OTP normal. */
export async function tryDevBypassLogin(phone: string) {
  try {
    await request("/api/member-portal/verify", { method: "POST", body: JSON.stringify({ phone }) });
    return true;
  } catch {
    return false;
  }
}

export async function requestOtp(phone: string) {
  return request<{ message?: string; wa_delivered?: boolean }>("/api/member-portal/otp", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export async function verifyOtp(phone: string, code: string) {
  return request<{ data: { name: string } }>("/api/member-portal/verify", {
    method: "POST",
    body: JSON.stringify({ phone, code }),
  });
}

export async function logoutMember() {
  await request("/api/member-portal/logout", { method: "POST" }).catch(() => null);
}
