import { describe, expect, it } from "vitest";
import { parqAnswersComplete, parqDue, PARQ_QUESTIONS, PARQ_VERSION, planParqFlags } from "./parq";

const allNo = Object.fromEntries(PARQ_QUESTIONS.map((q) => [q.code, false]));

describe("PAR-Q", () => {
  it("semua pertanyaan wajib dijawab ya/tidak", () => {
    expect(parqAnswersComplete(allNo)).toBe(true);
    expect(parqAnswersComplete({ ...allNo, chest_pain: "yes" })).toBe(false);
    const { pregnancy: _skip, ...missing } = allNo;
    expect(parqAnswersComplete(missing)).toBe(false);
  });

  it("semua tidak → tanpa penanda", () => {
    expect(planParqFlags(allNo, "apa pun")).toEqual([]);
  });

  it("jawaban ya dikelompokkan per jenis penanda; gejala berbahaya → Kritis", () => {
    const plan = planParqFlags({ ...allNo, medication: true, bone_joint: true, pregnancy: true }, null);
    expect(plan).toEqual([
      { type: "medical_condition", severity: "attention", note: "PAR-Q: obat rutin" },
      { type: "injury", severity: "attention", note: "PAR-Q: masalah tulang/sendi/otot" },
      { type: "pregnant", severity: "attention", note: "PAR-Q: hamil/baru melahirkan" },
    ]);
    const critical = planParqFlags({ ...allNo, heart_condition: true, chest_pain: true }, "  pernah   operasi ");
    expect(critical).toEqual([
      { type: "medical_condition", severity: "critical", note: "PAR-Q: jantung/tekanan darah tinggi, nyeri dada. Keterangan member: pernah operasi" },
    ]);
  });

  it("catatan dipotong sesuai batas catatan penanda", () => {
    const [p] = planParqFlags({ ...allNo, bone_joint: true }, "x".repeat(400), 200);
    expect(p.note).toHaveLength(200);
    expect(p.note.endsWith("…")).toBe(true);
  });

  it("perlu diisi: belum pernah, versi lama, atau lewat 12 bulan", () => {
    const now = new Date("2026-10-22T00:00:00Z");
    expect(parqDue(null, now)).toBe(true);
    expect(parqDue({ submitted_at: "2026-01-01T00:00:00Z", version: PARQ_VERSION }, now)).toBe(false);
    expect(parqDue({ submitted_at: "2025-10-21T00:00:00Z", version: PARQ_VERSION }, now)).toBe(true);
    expect(parqDue({ submitted_at: "2026-10-01T00:00:00Z", version: "parq-lama" }, now)).toBe(true);
  });
});
