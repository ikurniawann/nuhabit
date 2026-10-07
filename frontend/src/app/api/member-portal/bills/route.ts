import { getMemberBillDetail } from "@/lib/pos/member-bill-server";
import { memberJson, withMemberSession } from "@/lib/member-portal/route";

export const dynamic = "force-dynamic";

/**
 * GET — Tagihan Member milik sendiri: order terbuka (belum lunas) beserta
 * item, saldo tagihan, dan riwayat cicilan. Hanya baca; pembayaran tetap di
 * kasir. Nama kasir, catatan, dan referensi internal tidak dikirim ke member.
 */
export const GET = withMemberSession("Gagal memuat tagihan", async (customerId) => {
  const bill = await getMemberBillDetail(customerId);
  return memberJson({
    balance: bill.balance,
    open_orders: bill.open_orders.map((order) => ({
      id: order.id,
      order_number: order.order_number,
      ordered_at: order.ordered_at,
      total_amount: order.total_amount,
      items: order.items,
    })),
    payments: bill.payments.map((payment) => ({
      id: payment.id,
      amount: payment.amount,
      method: payment.payment_method_name ?? payment.payment_method,
      created_at: payment.created_at,
    })),
  });
});
