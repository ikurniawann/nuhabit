import { describe, expect, test } from "vitest";
import {
  boolLabel,
  EMPLOYMENT_STATUS_LABELS,
  formatDate,
  formatDateTime,
  formatIdr,
  formatScore,
  labelOf,
  OBSERVATION_SOURCE_LABELS,
  OFFER_STATUS_LABELS,
  RECOMMENDATION_LABELS,
  reportFileName,
} from "./pipeline-report-format";

describe("labelOf", () => {
  test("returns Indonesian label for known key", () => {
    expect(labelOf(RECOMMENDATION_LABELS, "tidak_lolos")).toBe("Tidak Lolos");
    expect(labelOf(OFFER_STATUS_LABELS, "negotiating")).toBe("Negosiasi");
  });

  test("falls back to raw key for unknown value", () => {
    expect(labelOf(OFFER_STATUS_LABELS, "withdrawn")).toBe("withdrawn");
  });

  test("returns dash for null or empty key", () => {
    expect(labelOf(RECOMMENDATION_LABELS, null)).toBe("-");
    expect(labelOf(RECOMMENDATION_LABELS, undefined)).toBe("-");
    expect(labelOf(RECOMMENDATION_LABELS, "")).toBe("-");
  });
});

describe("OBSERVATION_SOURCE_LABELS", () => {
  test("maps observation source to Indonesian label", () => {
    expect(labelOf(OBSERVATION_SOURCE_LABELS, "ai")).toBe("Otomatis (AI vision)");
    expect(labelOf(OBSERVATION_SOURCE_LABELS, "manual")).toBe("Manual (HRD)");
  });

  test("record lama tanpa observation_source dianggap manual via fallback dash", () => {
    expect(labelOf(OBSERVATION_SOURCE_LABELS, undefined)).toBe("-");
  });
});

describe("EMPLOYMENT_STATUS_LABELS", () => {
  test("maps employment status to Indonesian label", () => {
    expect(labelOf(EMPLOYMENT_STATUS_LABELS, "probation")).toBe("Probation");
    expect(labelOf(EMPLOYMENT_STATUS_LABELS, "contract")).toBe("Kontrak");
    expect(labelOf(EMPLOYMENT_STATUS_LABELS, "permanent")).toBe("Tetap");
    expect(labelOf(EMPLOYMENT_STATUS_LABELS, "internship")).toBe("Magang");
  });
});

describe("formatIdr", () => {
  test("formats number with thousand separators", () => {
    expect(formatIdr(5000000)).toBe("Rp 5.000.000");
  });

  test("accepts numeric string (pg bigint comes back as string)", () => {
    expect(formatIdr("7500000")).toBe("Rp 7.500.000");
  });

  test("returns dash for null, undefined, empty, and non-numeric", () => {
    expect(formatIdr(null)).toBe("-");
    expect(formatIdr(undefined)).toBe("-");
    expect(formatIdr("")).toBe("-");
    expect(formatIdr("abc")).toBe("-");
  });
});

describe("formatDateTime / formatDate", () => {
  test("formats ISO string in Indonesian locale (WIB)", () => {
    const result = formatDateTime("2026-07-15T09:30:00Z");
    expect(result).toContain("15 Juli 2026");
    expect(result).toContain("16.30");
  });

  test("formatDate omits the time part", () => {
    expect(formatDate("2026-07-15T09:30:00Z")).toBe("15 Juli 2026");
  });

  test("returns dash for null and invalid input", () => {
    expect(formatDateTime(null)).toBe("-");
    expect(formatDateTime("not-a-date")).toBe("-");
    expect(formatDate(undefined)).toBe("-");
  });
});

describe("boolLabel", () => {
  test("maps booleans to Ya/Tidak and nullish to dash", () => {
    expect(boolLabel(true)).toBe("Ya");
    expect(boolLabel(false)).toBe("Tidak");
    expect(boolLabel(null)).toBe("-");
    expect(boolLabel(undefined)).toBe("-");
  });
});

describe("formatScore", () => {
  test("rounds and renders as x/100", () => {
    expect(formatScore(86.6)).toBe("87/100");
    expect(formatScore("70")).toBe("70/100");
  });

  test("returns dash for missing or invalid score", () => {
    expect(formatScore(null)).toBe("-");
    expect(formatScore("")).toBe("-");
    expect(formatScore("n/a")).toBe("-");
  });
});

describe("reportFileName", () => {
  test("slugifies candidate name", () => {
    expect(reportFileName("Budi Santoso")).toBe("laporan-pipeline-budi-santoso.pdf");
  });

  test("strips symbols and accents, trims dashes", () => {
    expect(reportFileName("  Émile O'Connor Jr. ")).toBe(
      "laporan-pipeline-emile-o-connor-jr.pdf"
    );
  });

  test("falls back to 'kandidat' when name has no usable characters", () => {
    expect(reportFileName("!!!")).toBe("laporan-pipeline-kandidat.pdf");
  });
});
