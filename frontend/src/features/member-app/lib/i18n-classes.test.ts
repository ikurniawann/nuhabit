import { describe, expect, it } from "vitest";
import { fill } from "./i18n";

describe("fill", () => {
  it("replaces known placeholders and leaves unknown ones", () => {
    expect(fill("Kelas penuh - kamu urutan #{n} di daftar tunggu.", { n: 3 })).toBe(
      "Kelas penuh - kamu urutan #3 di daftar tunggu."
    );
    expect(fill("{name} dan {other}", { name: "Rizky" })).toBe("Rizky dan {other}");
  });
});
