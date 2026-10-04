import { describe, expect, it } from "vitest";
import {
  emptyBucket,
  finalizeBucket,
  resolveRevenueGroup,
  safePct,
} from "./revenue-composition";

describe("resolveRevenueGroup", () => {
  it("mengelompokkan kategori minuman sebagai Beverage", () => {
    expect(resolveRevenueGroup({ itemCategory: "YOKOCO-BEVERAGE-STALL" })).toBe("beverage");
    expect(resolveRevenueGroup({ itemCategory: "COFFEE-MATCHA-BAR-STALL" })).toBe("beverage");
    expect(resolveRevenueGroup({ itemCategory: "COFFEE" })).toBe("beverage");
    expect(resolveRevenueGroup({ itemCategory: "TEA" })).toBe("beverage");
    expect(resolveRevenueGroup({ posCategoryName: "Minuman" })).toBe("beverage");
  });

  it("mengelompokkan stall makanan sebagai Food", () => {
    expect(resolveRevenueGroup({ itemCategory: "SUSHI-SASHIMI-STALL" })).toBe("food");
    expect(resolveRevenueGroup({ itemCategory: "YAKITORI-STALL" })).toBe("food");
    expect(resolveRevenueGroup({ itemCategory: "RAMEN-NOODLES-STALL" })).toBe("food");
  });

  it("menempatkan bakery dan dessert di Food, bukan Beverage", () => {
    // "BAKERY-BAR" mengandung kata "bar" — bakery harus diperiksa lebih dulu.
    expect(resolveRevenueGroup({ itemCategory: "BAKERY-BAR" })).toBe("food");
    expect(resolveRevenueGroup({ itemCategory: "BAKERY-STALL" })).toBe("food");
    expect(resolveRevenueGroup({ posCategoryName: "Dessert" })).toBe("food");
  });

  it("mendahulukan kategori master daripada kategori POS", () => {
    // Kasus nyata: produk YOKOCO-BEVERAGE yang bucket kasirnya tertulis Makanan.
    expect(
      resolveRevenueGroup({ itemCategory: "YOKOCO-BEVERAGE-STALL", posCategoryName: "Makanan" })
    ).toBe("beverage");
  });

  it("memakai station hanya bila tidak ada kategori sama sekali", () => {
    expect(resolveRevenueGroup({ station: "bar" })).toBe("beverage");
    expect(resolveRevenueGroup({ station: "kitchen" })).toBe("food");
    expect(resolveRevenueGroup({ station: "bakery" })).toBe("food");
    // Kategori ada → station diabaikan meski bertentangan.
    expect(resolveRevenueGroup({ itemCategory: "SUSHI-SASHIMI-STALL", station: "bar" })).toBe("food");
  });

  it("mengembalikan Food untuk masukan kosong", () => {
    expect(resolveRevenueGroup({})).toBe("food");
    expect(resolveRevenueGroup({ itemCategory: "   ", posCategoryName: null })).toBe("food");
  });
});

describe("safePct", () => {
  it("menghitung persentase dan membulatkan dua desimal", () => {
    expect(safePct(25, 100)).toBe(25);
    expect(safePct(1, 3)).toBe(33.33);
  });

  it("mengembalikan 0 saat penyebutnya nol", () => {
    expect(safePct(10, 0)).toBe(0);
    expect(safePct(0, 0)).toBe(0);
  });
});

describe("finalizeBucket", () => {
  it("menurunkan margin, cost%, dan porsi kontribusi", () => {
    const bucket = { ...emptyBucket("food", "Food"), quantity: 40, sales: 1000, cost: 280 };
    const result = finalizeBucket(bucket, { sales: 1250, quantity: 50 });

    expect(result.margin).toBe(720);
    expect(result.cost_pct).toBe(28);
    expect(result.sales_share_pct).toBe(80);
    expect(result.qty_share_pct).toBe(80);
  });

  it("tidak pecah saat penjualan nol tapi biaya tercatat", () => {
    // Terjadi nyata: baris order beromzet 0 (porsi tes) yang tetap punya HPP.
    const bucket = { ...emptyBucket("x", "X"), quantity: 11, sales: 0, cost: 433920 };
    const result = finalizeBucket(bucket, { sales: 0, quantity: 11 });

    expect(result.margin).toBe(-433920);
    expect(result.cost_pct).toBe(0);
    expect(result.sales_share_pct).toBe(0);
    expect(result.qty_share_pct).toBe(100);
  });
});
