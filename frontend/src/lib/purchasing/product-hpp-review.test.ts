import { describe, expect, it } from "vitest";
import { buildProductHppReview } from "@/lib/purchasing/product-hpp-review";

describe("buildProductHppReview", () => {
  it("flags recipe products when stored HPP differs from BOM cost", () => {
    expect(
      buildProductHppReview({
        harga_modal: 10000,
        hpp_estimasi: 12500,
        total_bahan_baku: 3,
      })
    ).toMatchObject({
      hpp_tersimpan: 10000,
      hpp_resep: 12500,
      hpp_selisih: 2500,
      hpp_perlu_review: true,
    });
  });

  it("does not flag trading products without BOM", () => {
    expect(
      buildProductHppReview({
        harga_modal: 8000,
        hpp_estimasi: 0,
        total_bahan_baku: 0,
      })
    ).toMatchObject({
      hpp_perlu_review: false,
    });
  });

  it("does not flag when stored HPP already matches recipe", () => {
    expect(
      buildProductHppReview({
        harga_modal: 12500.4,
        hpp_estimasi: 12500.2,
        total_bahan_baku: 2,
      })
    ).toMatchObject({
      hpp_tersimpan: 12500,
      hpp_resep: 12500,
      hpp_selisih: 0,
      hpp_perlu_review: false,
    });
  });
});
