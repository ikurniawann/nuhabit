// EPIC-028 B2 — kirim WA saat pass online terbayar. Best-effort: gagal WA
// tidak menggagalkan webhook (pemanggil memutus sendiri). Meniru booking-wa.

import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import { appOrigin } from "@/lib/app-origin";

export interface PaidPassWaInput {
  pass_code: string;
  access_token: string;
  holder_name: string;
  holder_phone: string | null;
  valid_until: string;
}

export async function sendPassPaidWa(
  pass: PaidPassWaInput
): Promise<{ success: boolean; reason?: string }> {
  if (!pass.holder_phone) return { success: false, reason: "tanpa-nomor" };
  const config = await loadGatewayConfig();
  if (!config) {
    console.error("[pass] WA gateway belum dikonfigurasi — QR tidak terkirim");
    return { success: false, reason: "gateway-belum-dikonfigurasi" };
  }
  const baseUrl = appOrigin();
  const statusUrl = `${baseUrl}/pass/status/${pass.access_token}`;
  const message =
    `*Season Pass aktif* ✅\n\n` +
    `Kode pass: *${pass.pass_code}*\n` +
    `Atas nama: ${pass.holder_name}\n` +
    `Berlaku s/d: ${pass.valid_until}\n\n` +
    `Tunjukkan / scan QR di halaman ini saat masuk:\n${statusUrl}`;

  const result = await sendGatewayText(config, {
    target: pass.holder_phone,
    message,
  });
  if (!result.success) {
    console.error("[pass] kirim WA gagal:", result.reason);
    return { success: false, reason: result.reason };
  }
  return { success: true };
}
