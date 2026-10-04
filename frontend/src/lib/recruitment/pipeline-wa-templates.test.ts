import { describe, expect, it } from "vitest";
import {
  INTERVIEW_WA_TEMPLATES,
  INVITE_WA_MESSAGES,
  OFFER_REJECTION_WA_TEMPLATE,
  PSIKOTES_WA_TEMPLATES,
  SCREENING_WA_TEMPLATES,
} from "./pipeline-wa-templates";

describe("template WA tahap", () => {
  it("menyisipkan nama & posisi", () => {
    const msg = SCREENING_WA_TEMPLATES[0].build("Budi", "Barista");
    expect(msg).toContain("Halo Budi");
    expect(msg).toContain("posisi Barista");
  });

  it("kunci template sesuai tahap", () => {
    expect(SCREENING_WA_TEMPLATES.map((t) => t.key)).toEqual([
      "undangan_screening",
      "lolos_psikotes",
      "penolakan",
    ]);
    expect(PSIKOTES_WA_TEMPLATES.map((t) => t.key)).toEqual(["lolos_interview", "penolakan"]);
    expect(INTERVIEW_WA_TEMPLATES.map((t) => t.key)).toEqual(["lolos_offer", "penolakan"]);
  });

  it("penolakan screening berbeda dari penolakan setelah tes", () => {
    const screening = SCREENING_WA_TEMPLATES[2].build("A", "B");
    const afterTest = OFFER_REJECTION_WA_TEMPLATE.build("A", "B");
    expect(screening).toContain("waktu dan minat Anda");
    expect(afterTest).toContain("waktu dan partisipasi Anda");
    expect(PSIKOTES_WA_TEMPLATES[1]).toBe(OFFER_REJECTION_WA_TEMPLATE);
  });
});

describe("pesan undangan bertoken", () => {
  const input = { nama: "Budi", posisi: "Barista", link: "https://x.test/psikotes/abc", expiresDays: "3" };

  it("memuat link dan masa berlaku", () => {
    for (const build of Object.values(INVITE_WA_MESSAGES)) {
      const msg = build(input);
      expect(msg).toContain(input.link);
      expect(msg).toContain("(berlaku 3 hari)");
      expect(msg).toContain("Halo Budi");
    }
  });

  it("interview menyebut kamera & mikrofon", () => {
    expect(INVITE_WA_MESSAGES.undangan_interview(input)).toContain("kamera & mikrofon");
  });
});
