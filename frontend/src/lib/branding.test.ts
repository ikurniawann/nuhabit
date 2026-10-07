import { describe, expect, it } from "vitest";
import { DEFAULT_BRAND_NAME, brandName, brandOsName, pickBrandName } from "./branding";

describe("branding", () => {
  it("tanpa NEXT_PUBLIC_APP_NAME memakai merek default", () => {
    expect(brandName()).toBe(DEFAULT_BRAND_NAME);
    expect(brandOsName()).toBe(`${DEFAULT_BRAND_NAME} OS`);
  });

  it("pickBrandName memilih kandidat pertama yang terisi", () => {
    expect(pickBrandName("Dusun Bambu", "Sulu")).toBe("Dusun Bambu");
    expect(pickBrandName(null, "  ", "Dusun Bambu")).toBe("Dusun Bambu");
    expect(pickBrandName(null, undefined, "")).toBe(DEFAULT_BRAND_NAME);
  });
});
