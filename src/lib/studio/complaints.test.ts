import { describe, expect, it } from "vitest";
import {
  categoryFromCs,
  complaintCode,
  complaintDeadlines,
  complaintTitle,
  defaultComplaintPriority,
  isComplaintOpen,
} from "./complaints";

describe("complaintDeadlines", () => {
  const t0 = new Date("2026-10-22T02:00:00Z");

  it("cedera: respons 2 jam, selesai 24 jam", () => {
    const d = complaintDeadlines("injury", t0);
    expect(d.respondBy.toISOString()).toBe("2026-10-22T04:00:00.000Z");
    expect(d.resolveBy.toISOString()).toBe("2026-10-23T02:00:00.000Z");
  });

  it("lainnya: respons 24 jam, selesai 3 hari", () => {
    const d = complaintDeadlines("coach", t0);
    expect(d.respondBy.toISOString()).toBe("2026-10-23T02:00:00.000Z");
    expect(d.resolveBy.toISOString()).toBe("2026-10-25T02:00:00.000Z");
  });
});

describe("aturan kecil tiket", () => {
  it("prioritas awal cedera = tinggi", () => {
    expect(defaultComplaintPriority("injury")).toBe("high");
    expect(defaultComplaintPriority("facility")).toBe("normal");
  });

  it("kategori WA: pembayaran → billing, sisanya Lainnya", () => {
    expect(categoryFromCs("pembayaran")).toBe("billing");
    expect(categoryFromCs("layanan")).toBe("other");
    expect(categoryFromCs(null)).toBe("other");
  });

  it("terbuka = diterima / ditangani", () => {
    expect(isComplaintOpen("received")).toBe(true);
    expect(isComplaintOpen("in_progress")).toBe(true);
    expect(isComplaintOpen("resolved")).toBe(false);
    expect(isComplaintOpen("cancelled")).toBe(false);
  });

  it("kode per bulan WIB", () => {
    expect(complaintCode(new Date("2026-10-31T18:00:00Z"), 7)).toBe("KEL-2611-0007"); // 1 Nov 01.00 WIB
    expect(complaintCode(new Date("2026-10-22T02:00:00Z"), 123)).toBe("KEL-2610-0123");
  });

  it("judul: isian staf, lalu potongan deskripsi, lalu default kategori", () => {
    expect(complaintTitle("  AC ruang 2 mati ", null, "facility")).toBe("AC ruang 2 mati");
    expect(complaintTitle("", "Coach datang terlambat 20 menit dan kelas jadi molor sampai jam 8 lewat, member kecewa sekali", "coach")).toMatch(/…$/);
    expect(complaintTitle(null, null, "billing")).toBe("Keluhan billing");
  });
});
