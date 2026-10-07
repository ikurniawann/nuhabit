import { describe, expect, it } from "vitest";
import { buildLeaveRequestWaMessage, leaveTypeLabel } from "./leave-wa";

describe("leaveTypeLabel", () => {
  it("menerjemahkan tipe dikenal, tipe asing apa adanya", () => {
    expect(leaveTypeLabel("annual")).toBe("Cuti Tahunan");
    expect(leaveTypeLabel("sick")).toBe("Sakit");
    expect(leaveTypeLabel("lainnya")).toBe("lainnya");
  });
});

describe("buildLeaveRequestWaMessage", () => {
  it("memuat karyawan, rentang tanggal, jumlah hari, alasan, dan atasan", () => {
    const pesan = buildLeaveRequestWaMessage({
      leaveId: "x",
      employeeName: "Adi Suryaningrat",
      leaveType: "annual",
      startDate: "2026-09-07",
      endDate: "2026-09-09",
      totalDays: 3,
      reason: "Acara keluarga",
      approverName: "Erik Hidayat",
    });
    expect(pesan).toContain("Pengajuan Cuti Tahunan");
    expect(pesan).toContain("Kepada: Erik Hidayat");
    expect(pesan).toContain("Karyawan : Adi Suryaningrat");
    expect(pesan).toContain("s.d.");
    expect(pesan).toContain("(3 hari kerja)");
    expect(pesan).toContain("Alasan : Acara keluarga");
    expect(pesan).toContain("Mohon ditinjau");
  });

  it("satu hari: tanggal tunggal tanpa 's.d.'; tanpa alasan barisnya hilang", () => {
    const pesan = buildLeaveRequestWaMessage({
      leaveId: "x",
      employeeName: "Adi",
      leaveType: "sick",
      startDate: "2026-09-07",
      endDate: "2026-09-07",
      totalDays: 1,
      reason: null,
    });
    expect(pesan).not.toContain("s.d.");
    expect(pesan).not.toContain("Alasan");
    expect(pesan).toContain("(1 hari kerja)");
  });
});
