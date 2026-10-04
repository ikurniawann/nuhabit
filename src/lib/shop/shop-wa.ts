// EPIC-039 Fase D — notifikasi WA order toko online (best-effort, pola
// booking-wa: gagal WA tidak menggagalkan webhook).

import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import { appOrigin } from "@/lib/app-origin";

export interface ShopOrderWaInput {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  total: number;
  accessToken: string;
}

function formatRp(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

export interface ShopOrderShippedWaInput extends ShopOrderWaInput {
  waybill: string;
  courierLabel: string | null;
}

/** EPIC-039 Fase E — kirim resi saat order dikirim. */
export async function sendShopOrderShippedWa(
  order: ShopOrderShippedWaInput
): Promise<{ success: boolean; reason?: string }> {
  const config = await loadGatewayConfig();
  if (!config) {
    console.error("[shop] WA gateway belum dikonfigurasi — resi tidak terkirim");
    return { success: false, reason: "gateway-belum-dikonfigurasi" };
  }

  const baseUrl = appOrigin();
  const statusUrl = `${baseUrl}/shop/order/${order.accessToken}`;
  const message =
    `*Pesanan dikirim* 📦\n\n` +
    `Order: *${order.orderNumber}*\n` +
    (order.courierLabel ? `Kurir: ${order.courierLabel}\n` : "") +
    `Resi: *${order.waybill}*\n\n` +
    `Lacak status pengiriman di:\n${statusUrl}`;

  const result = await sendGatewayText(config, {
    target: order.customerPhone,
    message,
  });
  if (!result.success) {
    console.error(`[shop] WA resi gagal: order=${order.orderNumber}: ${result.reason}`);
  }
  return result;
}

export async function sendShopOrderPaidWa(
  order: ShopOrderWaInput
): Promise<{ success: boolean; reason?: string }> {
  const config = await loadGatewayConfig();
  if (!config) {
    console.error("[shop] WA gateway belum dikonfigurasi — konfirmasi order tidak terkirim");
    return { success: false, reason: "gateway-belum-dikonfigurasi" };
  }

  const baseUrl = appOrigin();
  const statusUrl = `${baseUrl}/shop/order/${order.accessToken}`;
  const message =
    `*Pembayaran diterima* ✅\n\n` +
    `Order: *${order.orderNumber}*\n` +
    `Atas nama: ${order.customerName}\n` +
    `Total: ${formatRp(order.total)}\n\n` +
    `Pesananmu sedang disiapkan. Pantau status & resi di:\n${statusUrl}`;

  const result = await sendGatewayText(config, {
    target: order.customerPhone,
    message,
  });
  if (!result.success) {
    console.error(`[shop] WA konfirmasi gagal: order=${order.orderNumber}: ${result.reason}`);
  }
  return result;
}
