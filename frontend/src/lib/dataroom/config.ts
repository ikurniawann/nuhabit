/**
 * Dataroom (owner 2026-09-04) — konstanta & helper murni.
 * Kuota total 50 GB (override DATAROOM_QUOTA_GB), batas per file 100 MB
 * (override DATAROOM_MAX_FILE_MB), masa aktif link 1–365 hari.
 */

export const DATAROOM_QUOTA_BYTES =
  Math.max(1, Number(process.env.DATAROOM_QUOTA_GB) || 50) * 1024 ** 3;
export const DATAROOM_MAX_FILE_BYTES =
  Math.max(1, Number(process.env.DATAROOM_MAX_FILE_MB) || 100) * 1024 ** 2;
export const DATAROOM_MAX_EXPIRY_DAYS = 365;
export const DATAROOM_DEFAULT_EXPIRY_DAYS = 7;
export const DATAROOM_STORAGE_PREFIX = "dataroom";

export type FileCategory =
  | "image" | "pdf" | "doc" | "sheet" | "slide" | "archive"
  | "video" | "audio" | "text" | "other";

const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", heic: "image/heic", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", md: "text/markdown", json: "application/json",
  zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg",
};

export function extensionOf(name: string): string {
  const raw = name.split(".").pop() ?? "";
  return raw && raw !== name && /^[a-z0-9]{1,6}$/i.test(raw) ? raw.toLowerCase() : "";
}

/** MIME dari ekstensi nama file (allow-list); kosong bila tak dikenal. */
export function mimeFromExtension(name: string): string {
  return EXT_MIME[extensionOf(name)] ?? "";
}

/** Ekstensi aman di disk: dari MIME allow-list, lalu ekstensi nama, lalu bin. */
export function extensionForStorage(mime: string, name: string): string {
  const byMime = Object.entries(EXT_MIME).find(([, m]) => m === mime)?.[0];
  if (byMime) return byMime === "jpeg" ? "jpg" : byMime;
  return extensionOf(name) || "bin";
}

export function sanitizeNodeName(input: string | null | undefined): string {
  const cleaned = String(input ?? "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[\\/]/g, "-")
    .trim()
    .replace(/^\.+$/, "");
  return (cleaned || "Tanpa nama").slice(0, 255);
}

export function clampExpiryDays(days: unknown): number {
  const n = Math.floor(Number(days));
  if (!Number.isFinite(n) || n < 1) return DATAROOM_DEFAULT_EXPIRY_DAYS;
  return Math.min(n, DATAROOM_MAX_EXPIRY_DAYS);
}

export function computeExpiry(days: unknown, now: Date = new Date()): Date {
  return new Date(now.getTime() + clampExpiryDays(days) * 86_400_000);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(String(value ?? "").trim());
}

/** Normalisasi daftar email: trim, lowercase, buang duplikat & yang tidak valid. */
export function normalizeEmails(list: unknown): string[] {
  const raw = Array.isArray(list) ? list : String(list ?? "").split(/[\s,;]+/);
  const out = new Set<string>();
  for (const item of raw) {
    const email = String(item ?? "").trim().toLowerCase();
    if (email && isValidEmail(email)) out.add(email);
  }
  return [...out];
}

export function isImageMime(mime: string | null | undefined): boolean {
  return /^image\/(jpeg|png|webp|gif|bmp|tiff)$/.test(String(mime ?? ""));
}

export function isPreviewable(mime: string | null | undefined): boolean {
  return isImageMime(mime) || mime === "application/pdf";
}

/** Watermark hanya untuk jpeg/png/webp (sharp) dan PDF (pdf-lib). */
export function isWatermarkable(mime: string | null | undefined): boolean {
  return /^image\/(jpeg|png|webp)$/.test(String(mime ?? "")) || mime === "application/pdf";
}

/** MIME yang tak boleh disajikan inline (stored XSS) → selalu attachment. */
export function mustForceAttachment(mime: string | null | undefined): boolean {
  const m = String(mime ?? "").toLowerCase();
  return m.includes("html") || m.includes("svg") || m.includes("xml") || m.includes("javascript");
}

export function fileCategory(mime: string | null | undefined, name = ""): FileCategory {
  const m = String(mime ?? "").toLowerCase();
  const ext = extensionOf(name);
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf") return "pdf";
  if (m.includes("word") || ext === "doc" || ext === "docx") return "doc";
  if (m.includes("sheet") || m.includes("excel") || m === "text/csv" || ext === "xls" || ext === "xlsx") return "sheet";
  if (m.includes("presentation") || m.includes("powerpoint")) return "slide";
  if (m.includes("zip") || m.includes("rar") || m.includes("7z") || m.includes("compressed")) return "archive";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("text/") || m === "application/json") return "text";
  return "other";
}

export function formatBytes(bytes: number | string | null | undefined): string {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** Kuota: apakah penambahan `incoming` byte masih muat. */
export function fitsQuota(usedBytes: number, incoming: number, quota = DATAROOM_QUOTA_BYTES): boolean {
  return usedBytes + incoming <= quota;
}
