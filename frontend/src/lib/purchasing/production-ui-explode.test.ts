import { describe, expect, it } from "vitest";
import { flattenBomTree, parseExplodeQty, type BomNode } from "./production-ui-explode";

const node = (id: string, level: number, children: BomNode[] | null = null): BomNode => ({
  raw_material_id: id,
  kode: id.toUpperCase(),
  nama: id,
  satuan: "kg",
  level,
  qty_per_parent: 1,
  recipe_qty_per: 1,
  recipe_satuan: "kg",
  unit_factor: 1,
  waste_factor: 0,
  qty_required: 1,
  qty_onhand: 0,
  shortage_qty: 1,
  unit_cost: 100,
  total_cost: 100,
  rolled_unit_cost: children ? 100 : null,
  has_recipe: Boolean(children),
  children,
});

describe("flattenBomTree", () => {
  it("lists each parent before its components with a key per path", () => {
    const rows = flattenBomTree([node("dough", 1, [node("flour", 2), node("salt", 2)]), node("flour", 1)]);
    expect(rows.map((row) => [row.raw_material_id, row.level])).toEqual([
      ["dough", 1],
      ["flour", 2],
      ["salt", 2],
      ["flour", 1],
    ]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(4);
  });
});

describe("parseExplodeQty", () => {
  it("accepts positive numbers with a comma or dot", () => {
    expect(parseExplodeQty("2,5")).toBe(2.5);
    expect(parseExplodeQty("10")).toBe(10);
    expect(parseExplodeQty("")).toBeNull();
    expect(parseExplodeQty("0")).toBeNull();
    expect(parseExplodeQty("abc")).toBeNull();
  });
});
