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
