import { describe, expect, it } from "vitest";
import {
  extractAttachmentText,
  isSupportedAttachment,
  MAX_EXTRACT_CHARS,
} from "./extract";

describe("isSupportedAttachment", () => {
  it("menerima dokumen, gambar, dan spreadsheet", () => {
    for (const name of ["a.pdf", "b.DOCX", "c.jpg", "d.png", "e.xlsx", "f.csv", "g.txt"]) {
      expect(isSupportedAttachment(name), name).toBe(true);
    }
  });

  it("menolak format yang tidak bisa dibaca", () => {
    for (const name of ["a.exe", "b.zip", "c.mp4", "tanpa-ekstensi"]) {
      expect(isSupportedAttachment(name), name).toBe(false);
    }
  });
});

describe("extractAttachmentText", () => {
  it("membaca CSV apa adanya", async () => {
    const csv = "nama,total\nAni,15000\nBudi,20000";
    const result = await extractAttachmentText(Buffer.from(csv), "belanja.csv");
    expect(result.method).toBe("text");
    expect(result.text).toContain("Budi,20000");
    expect(result.truncated).toBe(false);
  });

  it("memotong teks yang melebihi batas dan menandainya", async () => {
    // Tanpa batas ini, satu file besar bisa menghabiskan jendela konteks.
    const huge = "x".repeat(MAX_EXTRACT_CHARS + 500);
    const result = await extractAttachmentText(Buffer.from(huge), "besar.txt");
    expect(result.text).toHaveLength(MAX_EXTRACT_CHARS);
    expect(result.truncated).toBe(true);
  });

  it("merapikan baris kosong berlebih", async () => {
    const messy = "baris satu\n\n\n\n\nbaris dua   \n";
    const result = await extractAttachmentText(Buffer.from(messy), "catatan.txt");
    expect(result.text).toBe("baris satu\n\nbaris dua");
  });

  it("menolak format yang tidak didukung", async () => {
    await expect(extractAttachmentText(Buffer.from("x"), "virus.exe")).rejects.toThrow(
      /Format tidak didukung/
    );
  });

  it("menolak file yang isinya kosong", async () => {
    // Lebih baik memberi tahu user daripada mengirim lampiran hampa ke model.
    await expect(extractAttachmentText(Buffer.from("   \n\n  "), "kosong.txt")).rejects.toThrow(
      /Tidak ada teks/
    );
  });

  it("membaca spreadsheet menjadi CSV per sheet", async () => {
    const { buildXlsxBuffer } = await import("@/lib/spreadsheet/exceljs-safe");
    const buffer = await buildXlsxBuffer([
      { name: "Penjualan", rows: [["produk", "qty"], ["Kopi", 3]] },
    ]);

    const result = await extractAttachmentText(buffer, "laporan.xlsx");
    expect(result.method).toBe("spreadsheet");
    expect(result.text).toContain("### Sheet: Penjualan");
    expect(result.text).toContain("Kopi,3");
  });
});
