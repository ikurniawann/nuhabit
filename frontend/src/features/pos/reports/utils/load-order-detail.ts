import type { TransactionOrderDetail } from "../components/transaction-detail-body";

type CheckoutStamp = {
  checkout_number?: string | null;
  xendit_external_id?: string | null;
  xendit_qr_id?: string | null;
};

export async function loadOrderTransactionDetail(
  orderId: string,
  fallbackCheckoutId?: string | null
): Promise<TransactionOrderDetail> {
  const response = await fetch(`/api/pos/orders/${orderId}`, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error || "Gagal memuat detail transaksi");
  }

  const detail = payload.data as TransactionOrderDetail;
  const checkoutId = detail.checkout_id || fallbackCheckoutId;
  if (!checkoutId) return detail;

  const checkoutRes = await fetch(`/api/pos/checkouts/${checkoutId}`, {
    cache: "no-store",
  });
  const checkoutPayload = await checkoutRes.json().catch(() => ({}));
  const checkout = checkoutPayload?.data as CheckoutStamp | undefined;
  if (checkoutRes.ok && checkout) {
    detail.checkout_number = checkout.checkout_number ?? detail.checkout_number;
    detail.xendit_external_id =
      checkout.xendit_external_id ?? detail.xendit_external_id ?? null;
    detail.xendit_qr_id = checkout.xendit_qr_id ?? detail.xendit_qr_id ?? null;
  }
  return detail;
}
