import { describe, expect, it } from "vitest";
import { isOpaqueSku, pickDisplaySku } from "./order-item-sku";

describe("isOpaqueSku", () => {
  it("UUID dan 'SKU-<uuid>' dianggap tidak bermakna", () => {
    expect(isOpaqueSku("1d22f9ac-1861-47a9-8c38-d70fc565f568")).toBe(true);
    expect(isOpaqueSku("SKU-1d22f9ac-1861-47a9-8c38-d70fc565f568")).toBe(true);
    expect(isOpaqueSku("")).toBe(true);
    expect(isOpaqueSku(null)).toBe(true);
  });

  it("kode produk normal dianggap bermakna", () => {
    expect(isOpaqueSku("MM-STALL-02-005")).toBe(false);
    expect(isOpaqueSku("PUR-SND-001")).toBe(false);
    expect(isOpaqueSku("SKU-D")).toBe(false);
  });
});

describe("pickDisplaySku", () => {
  it("mengutamakan kode master, lalu sku POS, lalu snapshot", () => {
    expect(pickDisplaySku({ stored: "1d22f9ac-1861-47a9-8c38-d70fc565f568", masterKode: "MM-STALL-02-005", posSku: "PUR-MM-STALL-02-005" })).toBe("MM-STALL-02-005");
    expect(pickDisplaySku({ stored: "1d22f9ac-1861-47a9-8c38-d70fc565f568", posSku: "PUR-MM-STALL-02-005" })).toBe("PUR-MM-STALL-02-005");
    expect(pickDisplaySku({ stored: "SKU-D" })).toBe("SKU-D");
  });

  it("null bila semua kandidat kosong atau hanya UUID", () => {
    expect(pickDisplaySku({ stored: "1d22f9ac-1861-47a9-8c38-d70fc565f568" })).toBeNull();
    expect(pickDisplaySku({})).toBeNull();
  });
});
