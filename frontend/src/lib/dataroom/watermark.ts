import { brandName } from "@/lib/branding";
import { isWatermarkable } from "@/lib/dataroom/config";

/*
 * `sharp` (modul native) dan `pdf-lib` dimuat MALAS di dalam fungsi, bukan di
 * atas file. Insiden production 2026-09-04: impor statis sharp gagal saat
 * modul route dimuat (binary libvips tidak ter-trace di standalone) →
 * SEMUA endpoint Dataroom 500 termasuk daftar folder. Dengan impor malas,
 * kegagalan sharp hanya berdampak pada watermark (jatuh ke file asli).
 */

/**
 * Watermark saat file dibagikan (opsi per link): teks diagonal berulang
 * (email penerima / label + tanggal) ditanam saat file diunduh atau
 * dipratinjau — file asli di storage tidak pernah diubah.
 */

export function buildWatermarkText(input: { label?: string | null; date?: Date; brand?: string | null }): string {
  const label = String(input.label ?? "").trim() || String(input.brand ?? "").trim() || brandName();
  const d = input.date ?? new Date();
  const stamp = d.toLocaleString("id-ID", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
  });
  return `${label} - ${stamp.replace(", ", " ")}`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] as string);
}

/** Pure: SVG pola teks miring seukuran gambar (dipakai sharp.composite). */
export function watermarkTileSvg(width: number, height: number, text: string): string {
  const fontSize = Math.max(14, Math.round(Math.min(width, height) / 22));
  const tileW = Math.round(text.length * fontSize * 0.62 + fontSize * 3);
  const tileH = Math.round(fontSize * 5);
  const t = escapeXml(text);
  const y = Math.round(tileH / 2);
  const font = `font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="700"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs><pattern id="wm" width="${tileW}" height="${tileH}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
<text x="${fontSize}" y="${y}" ${font} fill="#ffffff" fill-opacity="0.35">${t}</text>
<text x="${fontSize - 1}" y="${y - 1}" ${font} fill="#111111" fill-opacity="0.22">${t}</text>
</pattern></defs>
<rect width="100%" height="100%" fill="url(#wm)"/></svg>`;
}

export async function applyImageWatermark(buffer: Buffer, mime: string, text: string): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const base = sharp(buffer).rotate(); // auto-orient EXIF
  const meta = await base.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) return buffer;
  const overlay = Buffer.from(watermarkTileSvg(width, height, text));
  const composed = base.composite([{ input: overlay, top: 0, left: 0 }]);
  if (mime === "image/png") return composed.png().toBuffer();
  if (mime === "image/webp") return composed.webp({ quality: 88 }).toBuffer();
  return composed.jpeg({ quality: 88 }).toBuffer();
}

export async function applyPdfWatermark(buffer: Buffer, text: string): Promise<Buffer> {
  const { PDFDocument, StandardFonts, degrees, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  // Font standar hanya punya glyph Latin dasar → karakter lain diganti "-"
  const safeText = text.replace(/[^\x20-\x7e]/g, "-");
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.max(10, Math.min(width, height) / 22);
    const textWidth = font.widthOfTextAtSize(safeText, size);
    const stepX = textWidth + size * 3;
    const stepY = size * 6;
    for (let y = -height; y < height * 2; y += stepY) {
      for (let x = -width; x < width * 2; x += stepX) {
        page.drawText(safeText, {
          x, y, size, font, rotate: degrees(30),
          color: rgb(0.25, 0.25, 0.25), opacity: 0.2,
        });
      }
    }
  }
  return Buffer.from(await doc.save());
}

/** null → tipe file tidak mendukung watermark (kirim apa adanya). */
export async function applyWatermark(buffer: Buffer, mime: string, text: string): Promise<Buffer | null> {
  if (!isWatermarkable(mime)) return null;
  if (mime === "application/pdf") return applyPdfWatermark(buffer, text);
  return applyImageWatermark(buffer, mime, text);
}
