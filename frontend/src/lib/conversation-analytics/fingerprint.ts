import type { TranscriptMessage } from "./types";

/**
 * Sidik jari transkrip untuk invalidasi cache analisa.
 *
 * Dipakai supaya percakapan yang isinya TIDAK berubah tidak dianalisa ulang —
 * inilah yang menjaga tagihan token tetap masuk akal saat laporan dibuka
 * berulang kali. Hash-nya FNV-1a yang ditulis tangan (bukan node:crypto) agar
 * modul ini tetap bebas dependensi dan bisa berjalan di runtime mana pun.
 */
export function fingerprintTranscript(messages: TranscriptMessage[]): string {
  const source = messages
    .map((message) => `${message.direction}:${message.body ?? ""}`)
    .join("\n");

  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    // Perkalian FNV dijaga di ranah 32-bit unsigned lewat Math.imul.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${messages.length}-${hash.toString(16)}`;
}
