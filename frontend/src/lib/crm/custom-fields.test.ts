import { describe, expect, test } from "vitest";
import { customFieldSchema, formatCustomValue, mergeCustomValues, parseLocaleNumber, validateCustomValues, type CustomFieldDef } from "./custom-fields";

const defs: CustomFieldDef[] = [
  { id: "1", object: "lead", key: "budget", label: "Budget", field_type: "number", options: [], is_required: true, validation: { min: 0, max: 1_000_000_000 } },
  { id: "2", object: "lead", key: "segment", label: "Segmen", field_type: "picklist", options: ["A", "B"], is_required: false, validation: {} },
  { id: "3", object: "lead", key: "tags", label: "Tag", field_type: "multipicklist", options: ["x", "y"], is_required: false, validation: {} },
  { id: "4", object: "lead", key: "web", label: "Web", field_type: "url", options: [], is_required: false, validation: {} },
  { id: "5", object: "lead", key: "kode", label: "Kode", field_type: "text", options: [], is_required: false, validation: { pattern: "^[A-Z]{3}$" } },
  { id: "6", object: "lead", key: "vip", label: "VIP", field_type: "boolean", options: [], is_required: false, validation: {} },
];

describe("custom fields (EPIC-050 T-3.3)", () => {
  test("normalisasi tipe & buang kunci tak terdaftar", () => {
    const r = validateCustomValues(defs, { budget: "1.500", segment: "A", tags: "x, y", web: "https://a.id", kode: "ABC", vip: "true", asing: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.values).toEqual({ budget: 1500, segment: "A", tags: ["x", "y"], web: "https://a.id", kode: "ABC", vip: true });
      expect("asing" in r.values).toBe(false);
    }
  });

  test("required, range, picklist, url, pattern menghasilkan error per field", () => {
    const r = validateCustomValues(defs, { segment: "C", tags: ["z"], web: "a.id", kode: "abc", budget: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.key).sort()).toEqual(["budget", "kode", "segment", "tags", "web"]);
    const missing = validateCustomValues(defs, {});
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0].key).toBe("budget");
  });

  test("partial: required hanya dicek bila kunci dikirim; kosong → null", () => {
    const r = validateCustomValues(defs, { segment: "" }, { partial: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.values).toEqual({ segment: null });
    const r2 = validateCustomValues(defs, { budget: "" }, { partial: true });
    expect(r2.ok).toBe(false);
  });

  test("parseLocaleNumber: pemisah ribuan titik/koma", () => {
    expect(parseLocaleNumber("25.000.000")).toBe(25_000_000);
    expect(parseLocaleNumber("1.500,50")).toBe(1500.5);
    expect(parseLocaleNumber("1,5")).toBe(1.5);
    expect(parseLocaleNumber("1.5")).toBe(1.5);
    expect(parseLocaleNumber("1,500,000.25")).toBe(1_500_000.25);
    expect(Number.isNaN(parseLocaleNumber("abc"))).toBe(true);
  });

  test("merge & format", () => {
    expect(mergeCustomValues({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
    expect(formatCustomValue(defs[0], 1500000)).toBe("1.500.000");
    expect(formatCustomValue(defs[5], false)).toBe("Tidak");
    expect(formatCustomValue(defs[2], ["x", "y"])).toBe("x, y");
    expect(formatCustomValue(defs[1], null)).toBe("—");
  });

  test("skema definisi: key valid, picklist wajib opsi", () => {
    expect(customFieldSchema.safeParse({ object: "lead", key: "Budget", label: "B", field_type: "text" }).success).toBe(false);
    expect(customFieldSchema.safeParse({ object: "lead", key: "seg", label: "S", field_type: "picklist" }).success).toBe(false);
    expect(customFieldSchema.safeParse({ object: "deal", key: "seg", label: "S", field_type: "picklist", options: ["A"] }).success).toBe(true);
  });
});
