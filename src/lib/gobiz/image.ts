/**
 * URL foto produk untuk katalog GoFood. GoBiz hanya menerima JPEG/PNG
 * ("invalid image type" utk .webp — terbukti di sandbox 2026-09-28), sedangkan
 * foto produk BCD disimpan WebP. Foto non-JPEG/PNG dari server sendiri
 * dialihkan ke /api/public/gofood-image/<sumber base64url>.jpg yang
 * mengonversinya ke JPEG saat diminta.
 */

const DIRECT_EXT = /\.(jpe?g|png)$/i;
export const GOFOOD_IMAGE_ROUTE = "/api/public/gofood-image/";

/** Sumber yang boleh dikonversi: foto statis & unggahan storage kita sendiri. */
export function isConvertibleImageSource(src: string) {
  return (src.startsWith("/products/") || src.startsWith("/api/files/")) && !src.includes("..") && !src.includes("\\");
}

export function encodeImageSource(src: string) {
  return Buffer.from(src, "utf8").toString("base64url");
}

export function decodeImageSource(token: string): string | null {
  if (!/^[A-Za-z0-9_-]{4,400}$/.test(token)) return null;
  const src = Buffer.from(token, "base64url").toString("utf8");
  return isConvertibleImageSource(src) ? src : null;
}

export function gofoodImageUrl(image: string | null | undefined, appUrl: string): string | undefined {
  const value = String(image || "").trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return DIRECT_EXT.test(value.split("?")[0]) ? value : undefined;
  if (!appUrl) return undefined;
  const base = appUrl.replace(/\/$/, "");
  const path = value.startsWith("/") ? value : `/${value}`;
  if (DIRECT_EXT.test(path.split("?")[0])) return `${base}${path}`;
  if (!isConvertibleImageSource(path)) return undefined;
  return `${base}${GOFOOD_IMAGE_ROUTE}${encodeImageSource(path)}.jpg`;
}
