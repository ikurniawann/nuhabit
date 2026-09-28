import { getSettings, SETTING_KEYS } from "@/lib/settings/app-settings";

/**
 * Static QRIS: gambar QRIS statis milik venue (dicetak bank/penyedia QRIS,
 * nominal diisi pemesan sendiri). Dipakai self-order sebagai alternatif QRIS
 * dinamis Xendit — pembayaran tidak terverifikasi otomatis, jadi pemesan
 * mengunggah bukti bayar dan kasir yang melunasi order.
 *
 * Gambar disimpan di bucket publik (memang untuk dipindai siapa saja);
 * bukti bayar pemesan disimpan di storage/private.
 */

export const STATIC_QRIS_BUCKET = "payment-qris";
export const STATIC_QRIS_MAX_BYTES = 5 * 1024 * 1024;
/** Tangkapan layar HP modern bisa > 5 MB. */
export const PAYMENT_PROOF_MAX_BYTES = 8 * 1024 * 1024;
export const PAYMENT_PROOF_FOLDER = "payment-proofs";

export type StaticQrisConfig = {
  enabled: boolean;
  imageUrl: string | null;
  /** Siap dipakai pemesan = aktif DAN gambar sudah diunggah. */
  available: boolean;
};

export function parseStaticQris(enabledRaw: string | null, imageUrlRaw: string | null): StaticQrisConfig {
  const imageUrl = imageUrlRaw?.trim() || null;
  const enabled = enabledRaw === "true";
  return { enabled, imageUrl, available: enabled && Boolean(imageUrl) };
}

export async function loadStaticQris(): Promise<StaticQrisConfig> {
  const settings = await getSettings([SETTING_KEYS.STATIC_QRIS_ENABLED, SETTING_KEYS.STATIC_QRIS_IMAGE_URL]);
  return parseStaticQris(
    settings[SETTING_KEYS.STATIC_QRIS_ENABLED],
    settings[SETTING_KEYS.STATIC_QRIS_IMAGE_URL]
  );
}

/** Path bukti bayar selalu di bawah folder order-nya — cegah baca berkas lain. */
export function isPaymentProofPathFor(orderId: string, relPath: string | null | undefined): relPath is string {
  if (!relPath) return false;
  return relPath.startsWith(`${PAYMENT_PROOF_FOLDER}/${orderId}/`) && !relPath.includes("..");
}
