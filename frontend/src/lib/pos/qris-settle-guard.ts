/**
 * Gate settle QRIS di server: jangan tandai lunas hanya karena klien
 * menekan Confirm saat QR masih dibuat, atau mendaur ulang QR transaksi lama.
 */
export function assertQrisSaleMaySettle(input: {
  paymentMethod: string;
  xenditQrId?: string | null;
  xenditExternalId?: string | null;
  alreadyUsedByPaidOrder: boolean;
}): { ok: true } | { ok: false; message: string } {
  if (input.paymentMethod !== "qris") return { ok: true };
  if (!String(input.xenditQrId || "").trim() && !String(input.xenditExternalId || "").trim()) {
    return { ok: false, message: "Menunggu pembayaran QRIS" };
  }
  if (input.alreadyUsedByPaidOrder) {
    return { ok: false, message: "QRIS ini sudah dipakai transaksi lain" };
  }
  return { ok: true };
}
