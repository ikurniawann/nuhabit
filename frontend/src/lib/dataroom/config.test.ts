import { describe, expect, it } from "vitest";
import {
  clampExpiryDays, computeExpiry, extensionForStorage, fileCategory, fitsQuota, formatBytes,
  isWatermarkable, mimeFromExtension, mustForceAttachment, normalizeEmails, sanitizeNodeName,
} from "./config";

describe("dataroom config helpers", () => {
  it("sanitizeNodeName membuang karakter kontrol & slash, fallback 'Tanpa nama'", () => {
    expect(sanitizeNodeName("  Laporan/2026\\Q1.pdf ")).toBe("Laporan-2026-Q1.pdf");
    expect(sanitizeNodeName("ab")).toBe("ab");
    expect(sanitizeNodeName("")).toBe("Tanpa nama");
    expect(sanitizeNodeName("..")).toBe("Tanpa nama");
    expect(sanitizeNodeName("x".repeat(300))).toHaveLength(255);
  });

  it("masa aktif link di-clamp 1..365 hari (default 7)", () => {
    expect(clampExpiryDays(0)).toBe(7);
    expect(clampExpiryDays("abc")).toBe(7);
    expect(clampExpiryDays(3.9)).toBe(3);
    expect(clampExpiryDays(9999)).toBe(365);
    const now = new Date("2026-09-04T00:00:00Z");
    expect(computeExpiry(7, now).toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });

  it("normalizeEmails: trim, lowercase, unik, buang yang tidak valid", () => {
    expect(normalizeEmails(" A@x.com, a@X.com; b@y.id salah ")).toEqual(["a@x.com", "b@y.id"]);
    expect(normalizeEmails(["c@z.co", "", null])).toEqual(["c@z.co"]);
  });

  it("MIME & kategori", () => {
    expect(mimeFromExtension("Foto.JPG")).toBe("image/jpeg");
    expect(mimeFromExtension("tanpa-ekstensi")).toBe("");
    expect(extensionForStorage("image/jpeg", "x.jpeg")).toBe("jpg");
    expect(extensionForStorage("application/x-unknown", "arsip.tar")).toBe("tar");
    expect(extensionForStorage("application/x-unknown", "noext")).toBe("bin");
    expect(fileCategory("application/pdf")).toBe("pdf");
    expect(fileCategory("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("sheet");
    expect(fileCategory("application/octet-stream", "a.docx")).toBe("doc");
    expect(isWatermarkable("image/png")).toBe(true);
    expect(isWatermarkable("image/gif")).toBe(false);
    expect(mustForceAttachment("image/svg+xml")).toBe(true);
    expect(mustForceAttachment("application/pdf")).toBe(false);
  });

  it("kuota & format byte", () => {
    expect(fitsQuota(10, 5, 15)).toBe(true);
    expect(fitsQuota(10, 6, 15)).toBe(false);
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(50 * 1024 ** 3)).toBe("50 GB");
  });
});
