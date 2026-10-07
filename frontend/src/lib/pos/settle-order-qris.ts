import type { DbClient } from "@/lib/pg/types";
import { ensureQueueNumber } from "@/lib/pos/queue-number";
import { AccountingPostError, postPosSaleAccountingJournals } from "@/lib/pos/accounting-posting";
import { awardCrmXpForPosOrder, syncPosCustomerOrderStats } from "@/lib/crm/loyalty-engine";

export type SettleOrderQrisResult =
  | { status: "not_found"; orderId: string }
  | { status: "already_paid"; orderId: string }
  | { status: "skip_checkout_child"; orderId: string }
  | { status: "settled"; orderId: string; queueNumber: string | null };

/**
 * Bug #2 fix (insiden 2026-08-25): webhook Xendit hanya tahu topup dan
 * checkout gabungan (completeMixedCheckout) — QRIS yang diikat langsung ke
 * SATU order open bill (ditambahkan 2026-08-23 di POST /api/pos/qris) tidak
 * pernah dikenali di webhook, jadi tidak pernah auto-settle di sana.
 * Sebelum fix ini, satu-satunya jalur pelunasan order-bound QRIS adalah
 * polling client (PaymentModal) — kalau tab kasir ditutup / koneksi putus
 * di tengah polling, order tetap nyangkut unpaid meski uang sudah masuk.
 *
 * Fungsi ini idempotent (aman dipanggil berkali-kali / dobel webhook retry)
 * dan hanya menangani order MANDIRI (checkout_id null) — anak-order dari
 * checkout gabungan tetap lewat completeMixedCheckout seperti biasa.
 */
export async function settleOrderQrisPayment(
  db: DbClient,
  orderId: string
): Promise<SettleOrderQrisResult> {
  const { data: order, error } = await db
    .from("pos_orders")
    .select(
      "id, order_number, payment_status, total_amount, customer_id, company_id, branch_id, queue_number, checkout_id, cashier_id"
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  if (!order) return { status: "not_found", orderId };
  if (String(order.payment_status) === "paid") {
    return { status: "already_paid", orderId };
  }
  if (order.checkout_id) {
    // Anak-order checkout gabungan — completeMixedCheckout yang menangani.
    return { status: "skip_checkout_child", orderId };
  }

  const totalAmount = Number(order.total_amount) || 0;
  const { error: updateError } = await db
    .from("pos_orders")
    .update({
      payment_status: "paid",
      payment_method: "qris",
      amount_paid: totalAmount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);
  if (updateError) throw updateError;

  const queueNumber = await ensureQueueNumber(db, {
    id: orderId,
    queue_number: order.queue_number as string | null,
    company_id: order.company_id as string | null,
    branch_id: order.branch_id as string | null,
  });

  // Jurnal akuntansi butuh "aktor" — webhook tidak punya sesi kasir live,
  // jadi dipakai cashier_id yang tersimpan di order (pola sama dgn
  // completeMixedCheckout memakai checkout.cashier_id saat dipanggil webhook).
  const cashierId = String(order.cashier_id || "");
  if (cashierId) {
    try {
      await postPosSaleAccountingJournals({
        db,
        orderId,
        userId: cashierId,
        paymentMethod: "qris",
      });
    } catch (err) {
      if (err instanceof AccountingPostError) {
        console.error(`[pos] webhook accounting post failed: order=${orderId}:`, err.message);
      } else {
        throw err;
      }
    }
  } else {
    console.error(
      `[pos] webhook settle order=${orderId}: cashier_id kosong — jurnal akuntansi dilewati`
    );
  }

  if (order.customer_id) {
    await syncPosCustomerOrderStats(db, String(order.customer_id), totalAmount);
    const { data: orderItems } = await db
      .from("pos_order_items")
      .select("product_id, quantity, unit_price, subtotal, total_amount")
      .eq("order_id", orderId);
    await awardCrmXpForPosOrder(db, {
      orderId,
      customerId: String(order.customer_id),
      totalAmount,
      items: orderItems || [],
      outletId: order.branch_id as string | null,
      paymentMethod: "qris",
    });
  }

  return { status: "settled", orderId, queueNumber };
}
