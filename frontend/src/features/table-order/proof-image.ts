/**
 * Perkecil foto bukti bayar sebelum diunggah: foto kamera HP bisa 5–12 MB,
 * padahal kasir cukup membaca nominal & waktu transaksi. Hasil = JPEG sisi
 * terpanjang ≤ 1600px. Bila browser tak bisa men-decode (mis. HEIC di
 * Chrome) atau hasilnya justru lebih besar, file asli yang dikirim — server
 * tetap memvalidasi tipe dari isi berkas.
 */
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.85;
/** Di bawah ini tidak usah diproses (tangkapan layar kecil). */
const SKIP_BELOW_BYTES = 600 * 1024;

export async function compressProofImage(file: File): Promise<File> {
  if (file.size < SKIP_BELOW_BYTES || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], "bukti-bayar.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
