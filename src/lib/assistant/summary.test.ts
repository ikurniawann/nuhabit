import { describe, expect, it } from "vitest";
import { createEmptySystemSummary, detectIntent, generateSummaryAnswer } from "./summary";

describe("detectIntent", () => {
  it.each([
    ["Bagaimana KPI tim bulan ini?", "performance"],
    ["Total gaji karyawan", "payroll"],
    ["Berapa stok bahan baku?", "inventory"],
    ["Kandidat baru hari ini", "hris"],
    ["Halo", "all"],
  ])("%s → %s", (message, intent) => {
    expect(detectIntent(message)).toBe(intent);
  });
});

describe("generateSummaryAnswer", () => {
  const summary = {
    ...createEmptySystemSummary(),
    hris: { candidatesTotal: 12, candidatesToday: 2 },
    details: { hris: [{ id: "c1", full_name: "Sari", status: "applied" }] },
  };

  it("intent spesifik hanya merangkum modulnya plus baris terbaru", () => {
    const answer = generateSummaryAnswer("kandidat", summary, "Budi", "hris");
    expect(answer).toContain("HRIS: 12 total kandidat, 2 kandidat masuk hari ini");
    expect(answer).toContain("Kandidat terbaru: c1 | Sari | applied");
    expect(answer).not.toContain("Payroll:");
  });

  it("intent all menyapa user dan memuat semua modul", () => {
    const answer = generateSummaryAnswer("ringkas", summary, "Budi", "all");
    expect(answer.startsWith("Halo Budi")).toBe(true);
    expect(answer).toContain("Payroll: 0 payroll run");
  });
});
