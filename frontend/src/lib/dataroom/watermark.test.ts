import { describe, expect, it } from "vitest";
import { buildWatermarkText, watermarkTileSvg } from "./watermark";

describe("dataroom watermark", () => {
  it("teks watermark: label + tanggal WIB, fallback nama bisnis", () => {
    const d = new Date("2026-09-04T03:05:00Z");
    expect(buildWatermarkText({ label: "budi@wit.id", date: d })).toBe("budi@wit.id - 04/09/2026 10.05");
    expect(buildWatermarkText({ label: "", date: d })).toMatch(/^NüHabit - /);
  });

  it("SVG pola: ukuran sesuai gambar & teks di-escape", () => {
    const svg = watermarkTileSvg(800, 600, 'a<b>&"c"');
    expect(svg).toContain('width="800" height="600"');
    expect(svg).toContain("a&lt;b&gt;&amp;&quot;c&quot;");
    expect(svg).toContain('patternTransform="rotate(-30)"');
    expect(svg).not.toContain("a<b>");
  });
});
