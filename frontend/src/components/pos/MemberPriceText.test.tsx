// Owner 2026-10-01: kasir modern/klasik — member terpilih → harga reguler
// dicoret + harga member; tanpa member harga biasa.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { memberDiscountAmount, memberPrice } from "@/lib/pos/member-price";
import { MemberPriceText } from "./MemberPriceText";

afterEach(cleanup);

const fmt = (v: number) => `Rp ${v}`;

describe("memberPrice", () => {
  it("floor seperti stack diskon kasir; persen di luar 0–100 aman", () => {
    expect(memberPrice(28000, 10)).toBe(25200);
    expect(memberPrice(10005, 10)).toBe(9005);
    expect(memberPrice(28000, 0)).toBe(28000);
    expect(memberPrice(28000, 150)).toBe(0);
    expect(memberDiscountAmount(-5, 10)).toBe(0);
  });
});

describe("MemberPriceText", () => {
  it("member 10%: harga reguler dicoret + harga member", () => {
    render(<MemberPriceText price={28000} memberDiscountPercent={10} format={fmt} className="now" />);
    expect(screen.getByText("Rp 28000").className).toContain("line-through");
    expect(screen.getByText("Rp 25200").className).toContain("now");
  });

  it("tanpa member: satu harga, tanpa coret", () => {
    render(<MemberPriceText price={28000} format={fmt} className="now" />);
    const price = screen.getByText("Rp 28000");
    expect(price.className).toBe("now");
    expect(screen.queryByText("Rp 25200")).toBeNull();
  });
});
