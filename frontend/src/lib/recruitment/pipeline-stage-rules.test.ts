import { describe, expect, it } from "vitest";
import {
  EMPTY_SCREENING_DRAFT,
  appliedChecklist,
  countDone,
  cvPreviewKind,
  interviewChecklist,
  isScreeningDirty,
  offerChecklist,
  parseExpiresDays,
  parseMaxQuestions,
  parseOfferForm,
  parseSalaryInput,
  psikotesChecklist,
  salaryGap,
  screeningChecklist,
  screeningDraftFrom,
} from "./pipeline-stage-rules";
import type {
  CandidateOffer,
  InterviewAiSession,
  PsikotesSession,
  PsikotesSessionTest,
} from "./pipeline-types";

describe("applied", () => {
  it("checklist kontak butuh email & HP", () => {
    const items = appliedChecklist({ cvUrl: "/cv.pdf", email: "a@b.c", phone: " ", hasAnalysis: true, noteCount: 0 });
    expect(items.map((i) => i.done)).toEqual([true, true, false, false]);
    expect(countDone(items)).toBe(2);
  });

  it("jenis preview CV dari ekstensi", () => {
    expect(cvPreviewKind(null)).toBe("none");
    expect(cvPreviewKind("/x/CV.PDF")).toBe("pdf");
    expect(cvPreviewKind("/x/cv.jpeg")).toBe("image");
    expect(cvPreviewKind("/x/cv.docx")).toBe("other");
  });
});

describe("screening", () => {
  it("draft kosong saat belum ada data", () => {
    expect(screeningDraftFrom(null)).toBe(EMPTY_SCREENING_DRAFT);
  });

  it("dirty mengabaikan spasi di teks bebas", () => {
    const saved = { ...EMPTY_SCREENING_DRAFT, notes: "ok" };
    expect(isScreeningDirty({ ...saved, notes: "  ok " }, saved)).toBe(false);
    expect(isScreeningDirty({ ...saved, notes: "   " }, { ...saved, notes: null })).toBe(false);
    expect(isScreeningDirty({ ...saved, contacted: true }, saved)).toBe(true);
  });

  it("input gaji: hanya digit, maks 12 digit", () => {
    expect(parseSalaryInput("Rp 5.500.000")).toBe(5_500_000);
    expect(parseSalaryInput("")).toBeNull();
    expect(parseSalaryInput("1234567890123456")).toBe(123_456_789_012);
  });

  it("selisih gaji relatif ke ekspektasi", () => {
    expect(salaryGap(5_000_000, 6_500_000)).toBeCloseTo(0.3);
    expect(salaryGap(null, 6_500_000)).toBeNull();
    expect(salaryGap(5_000_000, null)).toBeNull();
  });

  it("checklist minat butuh catatan ketersediaan", () => {
    const items = screeningChecklist({ ...EMPTY_SCREENING_DRAFT, interested: true, availability_note: " " });
    expect(items[1].done).toBe(false);
    expect(countDone(items)).toBe(0);
  });
});

const test = (status: PsikotesSessionTest["status"]) => ({ status }) as PsikotesSessionTest;

describe("psikotes", () => {
  it("hint undangan, progres tes & proctoring", () => {
    const sessions = [
      { tests: [test("selesai"), test("pending")], proctor: { flags: 2, snapshots: 1 } },
    ] as PsikotesSession[];
    const items = psikotesChecklist(sessions, false);
    expect(items[0]).toMatchObject({ done: true, hint: "1 undangan" });
    expect(items[1]).toMatchObject({ done: false, hint: "1/2 tes" });
    expect(items[2]).toMatchObject({ done: true, hint: "2 flag · 1 snapshot" });
    expect(items[3].done).toBe(false);
  });

  it("tanpa sesi: semua belum, tanpa hint", () => {
    const items = psikotesChecklist([], true);
    expect(items.map((i) => i.hint)).toEqual([undefined, undefined, undefined, undefined]);
    expect(countDone(items)).toBe(1);
  });
});

describe("interview", () => {
  it("kesimpulan AI hanya dari sesi selesai", () => {
    const sessions = [
      { status: "completed", ai_summary: null, proctor: { flags: 0, snapshots: 0 } },
      { status: "in_progress", ai_summary: {}, proctor: { flags: 0, snapshots: 0 } },
    ] as unknown as InterviewAiSession[];
    const items = interviewChecklist(sessions);
    expect(items.map((i) => i.done)).toEqual([true, true, false, false]);
    expect(items[1].hint).toBe("1 sesi selesai");
  });
});

describe("offer", () => {
  it("diterima & respons tercatat", () => {
    const offers = [
      { status: "expired", responded_at: null },
      { status: "accepted", responded_at: "2026-10-01" },
    ] as CandidateOffer[];
    expect(offerChecklist(offers).map((i) => i.done)).toEqual([true, true, true]);
    expect(offerChecklist(offers)[0].hint).toBe("2 versi");
  });
});

describe("validasi undangan", () => {
  it("masa berlaku 1–30 hari bulat", () => {
    expect(parseExpiresDays("7")).toEqual({ ok: true, value: 7 });
    expect(parseExpiresDays("0").ok).toBe(false);
    expect(parseExpiresDays("2.5").ok).toBe(false);
  });

  it("pertanyaan interview 3–15", () => {
    expect(parseMaxQuestions("8")).toEqual({ ok: true, value: 8 });
    expect(parseMaxQuestions("16")).toEqual({ ok: false, error: "Jumlah pertanyaan harus 3–15" });
  });

  it("form offer: gaji wajib, benefit per baris maks 15", () => {
    const base = { salary: "", benefitsText: "", startDate: "", notes: "", expiresDays: "7" };
    expect(parseOfferForm(base)).toEqual({ ok: false, error: "Isi gaji pokok yang valid" });
    expect(parseOfferForm({ ...base, salary: "5000000", expiresDays: "31" }).ok).toBe(false);
    const parsed = parseOfferForm({
      ...base,
      salary: "5.500.000",
      benefitsText: ["BPJS", " ", ...Array.from({ length: 20 }, (_, i) => `B${i}`)].join("\n"),
      notes: "  ",
    });
    expect(parsed.ok && parsed.value).toMatchObject({
      base_salary: 5_500_000,
      start_date: null,
      notes: null,
      expires_days: 7,
    });
    expect(parsed.ok && parsed.value.benefits).toHaveLength(15);
  });
});
