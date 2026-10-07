// EPIC-028 B2 — kirim WA saat pass online terbayar. Best-effort: gagal WA
// tidak menggagalkan webhook (pemanggil memutus sendiri). Meniru booking-wa.

import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import { appOrigin } from "@/lib/app-origin";
import { formatDate } from "@/lib/format";

export interface PaidPassWaInput {
  pass_code: string;
  access_token: string;
  holder_name: string;
  holder_phone: string | null;
  valid_until: string;
}

/** Pesan WA pass aktif (QR = link status ber-token). */
export function buildPassPaidMessage(pass: PaidPassWaInput): string {
  return (
    `*Season Pass aktif* ✅\n\n` +
    `Kode pass: *${pass.pass_code}*\n` +
    `Atas nama: ${pass.holder_name}\n` +
    `Berlaku s/d: ${formatDate(pass.valid_until)}\n\n` +
    `Tunjukkan / scan QR di halaman ini saat masuk:\n${appOrigin()}/pass/status/${pass.access_token}`
  );
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
  const result = await sendGatewayText(config, {
    target: pass.holder_phone,
    message: buildPassPaidMessage(pass),
  });
  if (!result.success) {
    console.error("[pass] kirim WA gagal:", result.reason);
    return { success: false, reason: result.reason };
  }
  return { success: true };
}
