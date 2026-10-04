import { describe, expect, test } from "vitest";
import { sniffDocumentMime, sniffImageMime } from "./storage-private";

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

describe("sniffDocumentMime", () => {
  test("mendeteksi PDF dari magic bytes %PDF-", () => {
    // Arrange
    const buffer = Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj", "latin1");

    // Act
    const mime = sniffDocumentMime(buffer);

    // Assert
    expect(mime).toBe("application/pdf");
  });

  test("meneruskan deteksi gambar (PNG) bila bukan PDF", () => {
    expect(sniffDocumentMime(PNG_HEADER)).toBe("image/png");
  });

  test("menolak isi yang bukan PDF maupun gambar", () => {
    const buffer = Buffer.from("MZ\x90\x00 bukan dokumen sah padding", "latin1");
    expect(sniffDocumentMime(buffer)).toBeNull();
  });

  test("menolak buffer terlalu pendek", () => {
    expect(sniffDocumentMime(Buffer.from("%PDF"))).toBeNull();
  });

  test("PDF palsu bertipe klaim gambar tetap terdeteksi sebagai PDF", () => {
    const buffer = Buffer.from("%PDF-1.4 xxxxxxxxxxxx", "latin1");
    expect(sniffDocumentMime(buffer)).toBe("application/pdf");
    expect(sniffImageMime(buffer)).toBeNull();
  });
});
