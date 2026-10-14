import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBrandCss } from "../../scripts/brand-css.mjs";

const read = (file: string) => readFileSync(join(process.cwd(), "src/app", file), "utf8");

describe("brand.css", () => {
  const globals = read("globals.css");

  it("matches what scripts/brand-css.mjs builds from globals.css", () => {
    expect(read("brand.css")).toBe(buildBrandCss(globals));
  });

  it("carries the NüHabit Brand Guideline 2026 tokens", () => {
    const brand = read("brand.css");
    expect(brand).toContain("--brand-primary: #daff59;");
    expect(brand).toContain("--color-forest: #00281a;");
    expect(brand).toContain("--wit-ink: #131a1c;");
    expect(brand).toContain('--font-display: var(--font-outfit), "Outfit"');
    expect(brand).toContain('--font-sans-stack: var(--font-manrope), "Manrope"');
    expect(brand).toMatch(/\.notch \{\s+clip-path:/);
  });
});
