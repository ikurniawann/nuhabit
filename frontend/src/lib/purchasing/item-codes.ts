// Nomor kode master item (produk, bahan baku, barang operasional, pemakaian).

/** "20261004" dari tanggal UTC (cara lama route produk & barang operasional). */
export function utcDateStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10).replace(/-/g, "");
}

/** "20261004" dari tanggal lokal server (nomor pemakaian barang). */
export function localDateStamp(now: Date = new Date()): string {
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Kode berikutnya setelah `lastCode` (urutan di segmen terakhir): `PRD-20261004-007`
 * → `PRD-20261004-008`. Tanpa kode terakhir yang berangka, urutan mulai dari 1.
 */
export function nextSequentialCode(
  prefix: string,
  lastCode: string | null | undefined,
  pad: number
): string {
  const match = lastCode?.match(/-(\d+)$/);
  const seq = match ? parseInt(match[1], 10) + 1 : 1;
  return `${prefix}-${String(seq).padStart(pad, "0")}`;
}
