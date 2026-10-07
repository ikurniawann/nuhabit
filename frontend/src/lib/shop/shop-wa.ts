// EPIC-039 Fase D — notifikasi WA order toko online (best-effort, pola
// booking-wa: gagal WA tidak menggagalkan webhook).

import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import { appOrigin } from "@/lib/app-origin";
import { formatRupiah } from "@/lib/format";

export interface ShopOrderWaInput {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  total: number;
  accessToken: string;
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
    `*Order shipped* 📦\n\n` +
    `Order: *${order.orderNumber}*\n` +
    (order.courierLabel ? `Courier: ${order.courierLabel}\n` : "") +
    `Tracking number: *${order.waybill}*\n\n` +
    `Track your order here:\n${statusUrl}`;

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
    `*Payment received* ✅\n\n` +
    `Order: *${order.orderNumber}*\n` +
    `Name: ${order.customerName}\n` +
    `Total: ${formatRupiah(order.total)}\n\n` +
    `Your order is being prepared. Check its status and tracking number here:\n${statusUrl}`;

  const result = await sendGatewayText(config, {
    target: order.customerPhone,
    message,
  });
  if (!result.success) {
    console.error(`[shop] WA konfirmasi gagal: order=${order.orderNumber}: ${result.reason}`);
  }
  return result;
}
