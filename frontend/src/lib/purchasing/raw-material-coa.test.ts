import { describe, expect, it } from "vitest";
import {
  COA_COGS,
  COA_EXPENSE,
  COA_INV,
  deriveLegacyCoaEnum,
  resolveDefaultCoaForCategory,
} from "./raw-material-coa";

describe("resolveDefaultCoaForCategory", () => {
  it("maps system kategori to inventory + production COA", () => {
    expect(resolveDefaultCoaForCategory("KERING")).toMatchObject({
      coa_asset: COA_INV.DRY_GOODS,
      coa_production: COA_COGS.FOOD_RAW,
    });
    expect(resolveDefaultCoaForCategory("DAIRY")).toMatchObject({
      coa_asset: COA_INV.DAIRY_EGGS,
      coa_production: COA_COGS.FOOD_RAW,
    });
    expect(resolveDefaultCoaForCategory("SAYUR")).toMatchObject({
      coa_asset: COA_INV.OTHER,
      coa_production: COA_COGS.FRUIT_VEG,
    });
    expect(resolveDefaultCoaForCategory("BAKAR")).toMatchObject({
      coa_asset: COA_EXPENSE.PRODUCTION_FUEL,
      coa_production: COA_EXPENSE.PRODUCTION_FUEL,
    });
  });

  it("maps Market List category labels", () => {
    expect(resolveDefaultCoaForCategory("ST Dry Goods").coa_asset).toBe(
      COA_INV.DRY_GOODS
    );
    expect(resolveDefaultCoaForCategory("Fruit & Vegetable").coa_production).toBe(
      COA_COGS.FRUIT_VEG
    );
    expect(resolveDefaultCoaForCategory("ST Protein").coa_asset).toBe(
      COA_INV.OTHER
    );
  });
});

describe("deriveLegacyCoaEnum", () => {
  it("prefers production then rnd then asset", () => {
    expect(
      deriveLegacyCoaEnum({
        coa_production: "5101001",
        coa_asset: "1301001",
      })
    ).toBe("PRODUCTION");
    expect(deriveLegacyCoaEnum({ coa_rnd: "6201001" })).toBe("RND");
    expect(deriveLegacyCoaEnum({ coa_asset: "1301001" })).toBe("ASSET");
    expect(deriveLegacyCoaEnum({})).toBeNull();
  });
});
