import { describe, expect, it } from "vitest";
import { buildScopeInstruction, normalizePlainTextAnswer } from "./llm";

describe("normalizePlainTextAnswer", () => {
  it("membuang markdown tebal, heading, kutipan, dan backtick", () => {
    expect(normalizePlainTextAnswer("## Judul\n**Tebal** dan `kode`\n> kutip\n* poin")).toBe(
      "Judul\nTebal dan kode\nkutip\n- poin"
    );
  });
  it("bukan string → kosong", () => {
    expect(normalizePlainTextAnswer(null)).toBe("");
  });
});

describe("buildScopeInstruction", () => {
  it("memilih instruksi sesuai mode", () => {
    expect(buildScopeInstruction("project_only")).toContain("Mode Project Only aktif.");
    expect(buildScopeInstruction("general")).toContain("Mode General Chat aktif.");
  });
});
