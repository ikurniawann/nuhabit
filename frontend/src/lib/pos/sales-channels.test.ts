import { describe, expect, it } from "vitest";
import {
  isSoldIn,
  normalizeSalesChannels,
  salesChannelPresetKey,
  salesChannelSummary,
  soldInSql,
} from "./sales-channels";

describe("sales channels", () => {
  it("NULL / kosong = semua channel (produk lama tidak berubah)", () => {
    expect(isSoldIn(null, "pos")).toBe(true);
    expect(isSoldIn([], "self_order")).toBe(true);
    expect(isSoldIn(undefined, "gofood")).toBe(true);
  });

  it("hanya GoFood → tersembunyi di kasir & self-order", () => {
    expect(isSoldIn(["gofood"], "gofood")).toBe(true);
    expect(isSoldIn(["gofood"], "pos")).toBe(false);
    expect(isSoldIn(["gofood"], "self_order")).toBe(false);
    // teks array Postgres juga dikenali
    expect(isSoldIn("{gofood}", "pos")).toBe(false);
  });

  it("normalisasi membuang kode asing & duplikat", () => {
    expect(normalizeSalesChannels(["gofood", "gofood", "tokopedia"])).toEqual(["gofood"]);
    expect(normalizeSalesChannels(["x"])).toBeNull();
    expect(normalizeSalesChannels('{pos,"self_order"}')).toEqual(["pos", "self_order"]);
  });

  it("preset & ringkasan untuk UI", () => {
    expect(salesChannelPresetKey(null)).toBe("all");
    expect(salesChannelPresetKey(["gofood"])).toBe("gofood");
    expect(salesChannelPresetKey(["self_order", "pos"])).toBe("offline");
    expect(salesChannelPresetKey(["grabfood"])).toBe("custom");
    expect(salesChannelSummary(["gofood"])).toBe("GoFood");
    expect(salesChannelSummary(null)).toBe("Semua channel");
  });

  it("potongan SQL", () => {
    expect(soldInSql("p", "gofood")).toBe(
      "(p.sales_channels IS NULL OR cardinality(p.sales_channels) = 0 OR 'gofood' = ANY(p.sales_channels))"
    );
  });
});
