// EPIC-034 Fase B — kirim kode gift card ke WA pembeli saat dijual di kasir.
// Keputusan owner 27 Jul: struk TETAP mencetak kode; WA hanya tambahan bila
// kasir mengisi nomor pembeli. Best-effort — gateway mati TIDAK boleh
// menggagalkan penjualan (uang sudah diterima, kartu sudah terbit dan
// kodenya ada di struk). Meniru pass-wa.ts / booking-wa.ts.

import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import type { IssuedGiftCard } from "./giftcard-server";

const formatRp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

const formatExpiry = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "tanpa batas waktu";

export async function sendGiftCardSoldWa(input: {
  buyerName: string | null;
  buyerPhone: string | null;
  cards: IssuedGiftCard[];
}): Promise<{ success: boolean; reason?: string }> {
  if (!input.buyerPhone) return { success: false, reason: "tanpa-nomor" };
  if (input.cards.length === 0) return { success: false, reason: "tanpa-kartu" };

  const config = await loadGatewayConfig();
  if (!config) {
    console.error("[giftcard] WA gateway belum dikonfigurasi — kode tidak terkirim");
    return { success: false, reason: "gateway-belum-dikonfigurasi" };
  }

  const salam = input.buyerName ? `Halo ${input.buyerName},\n\n` : "";
  const daftarKartu = input.cards
    .map(
      (card) =>
        `• Kode: *${card.code}*\n  Saldo: ${formatRp(card.initial_value)}\n` +
        `  Berlaku: ${formatExpiry(card.expires_at)}`
    )
    .join("\n");
  const penutup =
    input.cards.length > 1
      ? "\n\nSimpan semua kode di atas baik-baik."
      : "\n\nSimpan kode ini baik-baik.";

  const message =
    `*Gift Card aktif* 🎁\n\n${salam}` +
    `Gift card kamu sudah aktif dan bisa langsung dipakai di kasir:\n\n` +
    `${daftarKartu}` +
    `${penutup} Siapa pun yang memegang kode ini bisa memakai saldonya.`;

  const result = await sendGatewayText(config, {
    target: input.buyerPhone,
    message,
  });
  if (!result.success) {
    console.error("[giftcard] kirim WA gagal:", result.reason);
    return { success: false, reason: result.reason };
  }
  return { success: true };
}
