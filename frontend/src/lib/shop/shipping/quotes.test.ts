import { describe, expect, it } from "vitest";
import { findQuote, withMarkup } from "./quotes";
import type { RateQuote } from "./types";

const quote = (courierCode: string, serviceCode: string, price: number): RateQuote => ({
  provider: "biteship",
  courierCode,
  courierName: courierCode.toUpperCase(),
  serviceCode,
  serviceName: serviceCode,
  price,
  etd: null,
});

describe("withMarkup", () => {
  it("membuang tarif 0 lalu menambah markup flat", () => {
    const priced = withMarkup([quote("jne", "reg", 10_000), quote("jnt", "ez", 0)], 2_500);
    expect(priced).toHaveLength(1);
    expect(priced[0]).toMatchObject({ courierCode: "jne", price: 10_000, total_price: 12_500 });
  });
});

describe("findQuote", () => {
  const quotes = [quote("JNE", "REG", 10_000), quote("sicepat", "best", 0)];

  it("mencocokkan kurir + layanan tanpa peduli huruf besar", () => {
    expect(findQuote(quotes, "jne", "reg")?.price).toBe(10_000);
  });

  it("layanan bertarif 0 atau tidak ada → undefined", () => {
    expect(findQuote(quotes, "sicepat", "best")).toBeUndefined();
    expect(findQuote(quotes, "jne", "yes")).toBeUndefined();
  });
});
