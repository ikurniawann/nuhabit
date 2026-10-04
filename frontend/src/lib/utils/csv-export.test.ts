import { describe, expect, it } from "vitest";
import { convertToCSV } from "./csv-export";

describe("convertToCSV", () => {
  it("menulis header, angka polos, teks berkutip, dan kutip ganda di-escape", () => {
    const csv = convertToCSV([{ nama: 'Kopi "Susu"', qty: 3, catatan: null }], [
      { key: "nama", label: "Nama" },
      { key: "qty", label: "Qty" },
      { key: "catatan", label: "Catatan" },
    ]);
    expect(csv).toBe('"Nama","Qty","Catatan"\n"Kopi ""Susu""",3,""');
  });

  it("membaca path bersarang dan memakai format kolom", () => {
    const csv = convertToCSV([{ bahan: { nama: "Gula" }, tipe: "in" }], [
      { key: "bahan.nama", label: "Bahan" },
      { key: "tipe", label: "Tipe", format: (v: string) => (v === "in" ? "Masuk" : v) },
    ]);
    expect(csv.split("\n")[1]).toBe('"Gula","Masuk"');
  });

  it("tanggal ditulis sebagai YYYY-MM-DD", () => {
    const csv = convertToCSV([{ at: new Date("2026-10-04T10:00:00Z") }], [{ key: "at", label: "Tanggal" }]);
    expect(csv.split("\n")[1]).toBe('"2026-10-04"');
  });
});
