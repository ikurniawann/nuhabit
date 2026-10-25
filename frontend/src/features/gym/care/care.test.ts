import { describe, expect, it } from "vitest";
import { memberIds } from "./api";
import { defaultExpiry, FLAG_BADGE, hiddenMedicalLabel, indexByMember, jakartaToday } from "./display";
import { parseInline, parseMarkdown } from "./markdown";

describe("flag display", () => {
  it("fills lime with forest text, never lime text", () => {
    expect(FLAG_BADGE.lime).toBe("accent");
    expect(Object.values(FLAG_BADGE)).not.toContain("default");
  });

  it("counts hidden medical flags", () => {
    expect(hiddenMedicalLabel(1)).toBe("1 penanda medis");
    expect(hiddenMedicalLabel(3)).toBe("3 penanda medis");
  });

  it("indexes roster flags by member", () => {
    const map = indexByMember([{ customer_id: "a", flags: [], hidden_medical: 2 }]);
    expect(map.get("a")?.hidden_medical).toBe(2);
    expect(indexByMember(undefined).size).toBe(0);
  });

  it("dates expiry on the Jakarta calendar", () => {
    expect(jakartaToday(new Date("2026-10-26T18:30:00Z"))).toBe("2026-10-27");
    expect(defaultExpiry("2026-10-27", 30)).toBe("2026-11-26");
    expect(defaultExpiry("2026-10-27", null)).toBe("");
  });

  it("sorts and dedupes roster ids for a stable query key", () => {
    expect(memberIds(["b", "a", "b"])).toEqual(["a", "b"]);
  });
});

describe("SOP markdown", () => {
  it("parses headings, lists and paragraphs", () => {
    const blocks = parseMarkdown("# SOP Cuti\n\nAjukan cuti\nlewat portal.\n\n- satu\n- **dua**\n\n1. pertama\n2. kedua\n## Sanksi");
    expect(blocks).toEqual([
      { kind: "heading", level: 1, text: [{ text: "SOP Cuti", bold: false }] },
      { kind: "paragraph", text: [{ text: "Ajukan cuti lewat portal.", bold: false }] },
      { kind: "list", ordered: false, items: [[{ text: "satu", bold: false }], [{ text: "dua", bold: true }]] },
      { kind: "list", ordered: true, items: [[{ text: "pertama", bold: false }], [{ text: "kedua", bold: false }]] },
      { kind: "heading", level: 2, text: [{ text: "Sanksi", bold: false }] },
    ]);
  });

  it("keeps an unpaired ** as text", () => {
    expect(parseInline("a **b** c")).toEqual([
      { text: "a ", bold: false },
      { text: "b", bold: true },
      { text: " c", bold: false },
    ]);
    expect(parseInline("2 ** 3")).toEqual([
      { text: "2 ", bold: false },
      { text: "** 3", bold: false },
    ]);
  });
});
