/**
 * Kompresi selfie absensi untuk PDF rekap (lanjutan permintaan owner
 * 2026-08-29): foto kamera ponsel bisa beberapa MB per lembar — rekap
 * sebulan penuh jadi puluhan MB. Di PDF fotonya hanya tampil ±90pt,
 * jadi dikecilkan dulu sebelum di-embed.
 *
 * Bonus: semua format masuk (termasuk webp yang tidak didukung pdfkit)
 * keluar sebagai JPEG, dan `rotate()` menerapkan orientasi EXIF sehingga
 * foto ponsel tidak tampil miring.
 */

/** Lebar maksimum thumbnail di PDF — 2× lebar tampil supaya tetap tajam. */
const MAX_WIDTH_PX = 480;
const JPEG_QUALITY = 62;

export async function compressAttendancePhoto(
  data: Buffer,
  mime: string
): Promise<{ data: Buffer; mime: string } | null> {
  try {
    // Import dinamis: sharp modul native — bila gagal termuat di suatu
    // lingkungan, kompresi dilewati dan ekspor tetap jalan (foto asli
    // dipakai bila formatnya didukung pdfkit).
    const { default: sharp } = await import("sharp");
    const compressed = await sharp(data)
      .rotate() // terapkan orientasi EXIF sebelum metadata dibuang
      .resize({ width: MAX_WIDTH_PX, withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    return { data: compressed, mime: "image/jpeg" };
  } catch {
    // File tak terbaca sharp (korup/format asing) — pakai aslinya bila
    // pdfkit sanggup; selain itu biarkan placeholder yang tampil.
    return /jpe?g|png/i.test(mime) ? { data, mime } : null;
  }
}
