import { describe, expect, it } from "vitest";
import { formatJobContext } from "./candidate-job-context";

describe("formatJobContext", () => {
  it("lowongan lebih diutamakan daripada master posisi", () => {
    expect(
      formatJobContext(
        { title: "Barista", description: "Seduh kopi", requirements: null },
        { title: "Barista", department: "Bar", level: "Staff" }
      )
    ).toBe("Posisi: Barista\nDeskripsi: Seduh kopi");
  });

  it("fallback ke posisi, lalu null", () => {
    expect(formatJobContext(null, { title: "Kasir", department: "Ops", level: null })).toBe(
      "Posisi: Kasir — Departemen Ops"
    );
    expect(formatJobContext(null, null)).toBeNull();
  });
});
