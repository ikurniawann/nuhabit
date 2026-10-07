import { describe, expect, test } from "vitest";
import { firstNameOnly, idleCfdState, parseCfdSnapshot } from "./cfd";

describe("firstNameOnly (privasi layar publik)", () => {
  test("hanya nama depan yang lolos", () => {
    expect(firstNameOnly("Budi Santoso Wijaya")).toBe("Budi");
    expect(firstNameOnly("  Ani  ")).toBe("Ani");
  });

  test("kosong/null → null", () => {
    expect(firstNameOnly("")).toBeNull();
    expect(firstNameOnly("   ")).toBeNull();
    expect(firstNameOnly(null)).toBeNull();
    expect(firstNameOnly(undefined)).toBeNull();
  });
});

describe("parseCfdSnapshot (data korup jangan meledak)", () => {
  test("state sah lolos utuh", () => {
    const state = idleCfdState(123);
    expect(parseCfdSnapshot(JSON.stringify(state))).toEqual(state);
  });

  test("JSON rusak / bentuk salah → null", () => {
    expect(parseCfdSnapshot(null)).toBeNull();
    expect(parseCfdSnapshot("{rusak")).toBeNull();
    expect(parseCfdSnapshot(JSON.stringify({ status: "ngawur", items: [] }))).toBeNull();
    expect(parseCfdSnapshot(JSON.stringify({ status: "cart" }))).toBeNull();
    expect(parseCfdSnapshot(JSON.stringify("string"))).toBeNull();
  });
});
