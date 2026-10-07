import { cancelTopup, getCustomers, getTopupHistory, getTopupStatus, processTopup } from "@/lib/pos-api";
import type {
  CustomerListParams,
  ProcessTopupPayload,
  TopupCustomer,
  TopupHistoryItem,
  TopupResult,
} from "./types";

export type * from "./types";

export async function listTopupCustomers(params: CustomerListParams = {}): Promise<TopupCustomer[]> {
  const res = await getCustomers(params);
  if (!res.success) {
    throw new Error("Failed to load customers");
  }
  return (res.data ?? []) as TopupCustomer[];
}

export async function submitTopup(payload: ProcessTopupPayload): Promise<TopupResult> {
  const res = await processTopup({
    customer_id: payload.customer_id,
    amount: payload.amount,
    payment_method: payload.payment_method as "qris" | "cash" | "credit" | "foc",
    supervisor_pin: payload.supervisor_pin,
    package_id: payload.package_id,
  });
  if (!res.success || !res.data) {
    throw new Error((res as { error?: string }).error || "Top-up failed");
  }
  return res.data as TopupResult;
}

export async function fetchTopupStatus(topupId: string): Promise<TopupResult> {
  const res = await getTopupStatus(topupId);
  if (!res.success || !res.data) {
    throw new Error((res as { error?: string }).error || "Failed to check top-up status");
  }
  return res.data as TopupResult;
}

export async function listTopupHistory(customerId: string, limit = 20): Promise<TopupHistoryItem[]> {
  const res = await getTopupHistory({ customer_id: customerId, limit });
  if (!res.success) {
    throw new Error((res as { error?: string }).error || "Failed to load top-up history");
  }
  return (res.data ?? []) as TopupHistoryItem[];
}

export async function submitCancelTopup(topupId: string): Promise<{ topup_id: string; status: string }> {
  const res = await cancelTopup(topupId);
  if (!res.success || !res.data) {
    throw new Error((res as { error?: string }).error || "Failed to cancel top-up");
  }
  return res.data as { topup_id: string; status: string };
}

export function buildTopupQrImageUrl(qrString: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qrString)}`;
}

async function postTopupAction(topupId: string, action: "send-wa" | "reconcile", body?: unknown) {
  const res = await fetch(`/api/pos/topup/${encodeURIComponent(topupId)}/${action}`, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const json = (await res.json()) as {
    success?: boolean;
    error?: string;
    message?: string;
    data?: Record<string, unknown> | null;
  };
  return { ok: res.ok && Boolean(json.success), json };
}

/** Kirim bukti top-up via WA ke nomor member; mengembalikan nomor tujuan. */
export async function sendTopupReceiptWa(topupId: string): Promise<string | null> {
  const { ok, json } = await postTopupAction(topupId, "send-wa", {});
  if (!ok) throw new Error(json.error || "Gagal mengirim WA");
  const phone = json.data?.phone;
  return typeof phone === "string" ? phone : null;
}

export type TopupReconcileResult = {
  completed: boolean;
  message?: string;
  /** Ada bila pembayaran ditemukan dan saldo sudah dikredit. */
  result: TopupResult | null;
};

/** Insiden 2026-09-04: cek langsung ke Xendit dan kredit bila pembayaran tercatat berhasil. */
export async function reconcileTopup(topupId: string): Promise<TopupReconcileResult> {
  const { ok, json } = await postTopupAction(topupId, "reconcile");
  if (!ok) throw new Error(json.error || "Gagal mengecek pembayaran");
  const data = json.data ?? null;
  const completed = data?.status === "completed";
  return {
    completed,
    message: json.message,
    result: completed && data && data.balance_after !== undefined ? (data as unknown as TopupResult) : null,
  };
}
