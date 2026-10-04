import { describe, expect, it } from "vitest";
import { buildXlsxBuffer, cellToString, parseXlsxToMatrix } from "@/lib/spreadsheet/exceljs-safe";

describe("cellToString", () => {
  it("menangani null, angka, tanggal, rich text, dan rumus", () => {
    expect(cellToString(null)).toBe("");
    expect(cellToString(42)).toBe("42");
    expect(cellToString({ richText: [{ text: "Es " }, { text: "Kopi" }] })).toBe("Es Kopi");
    expect(cellToString({ text: "Link", hyperlink: "http://x" })).toBe("Link");
    expect(cellToString({ result: 100, formula: "A1*2" })).toBe("100");
  });
});

describe("write lalu parse (round-trip)", () => {
  it("baris kembali sebagai matriks string rektangular", async () => {
    const buffer = await buildXlsxBuffer([
      { name: "Data", rows: [["kode", "nama", "harga"], ["A1", "Kopi", 25000], ["A2", "Teh", ""]] },
    ]);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    const matrix = await parseXlsxToMatrix(buffer);
    expect(matrix[0]).toEqual(["kode", "nama", "harga"]);
    expect(matrix[1]).toEqual(["A1", "Kopi", "25000"]);
    // sel kosong tetap ada sebagai "" (rektangular), bukan hilang
    expect(matrix[2]).toEqual(["A2", "Teh", ""]);
  });

  it("menghormati batas ukuran file", async () => {
    const big = Buffer.alloc(11);
    await expect(parseXlsxToMatrix(big, { limits: { maxBytes: 10 } })).rejects.toThrow(/terlalu besar/);
  });

  it("multi-sheet + lebar kolom + merge tidak melempar", async () => {
    const buffer = await buildXlsxBuffer([
      { name: "S1", rows: [["a", "b"]], columnWidths: [10, 20], merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }] },
      { name: "S2", rows: [["x"]] },
    ]);
    const matrix = await parseXlsxToMatrix(buffer); // sheet pertama
    expect(matrix[0][0]).toBe("a");
  });
});
