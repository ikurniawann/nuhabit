import { describe, expect, it } from "vitest";
import { checkSale, saleUntilInput } from "./product-settings";

describe("checkSale", () => {
  it("accepts a sale under the regular price and turns the end date into end of day WIB", () => {
    expect(checkSale({ salePrice: "20000", saleUntil: "2026-12-31" }, 25000)).toEqual({ ok: true, sale_price_idr: 20000, sale_until: "2026-12-31T23:59:59+07:00" });
    expect(checkSale({ salePrice: "20000", saleUntil: "" }, 25000)).toEqual({ ok: true, sale_price_idr: 20000, sale_until: null });
    expect(checkSale({ salePrice: "", saleUntil: "2026-12-31" }, 25000)).toEqual({ ok: true, sale_price_idr: null, sale_until: null });
  });

  it("rejects a sale at or above the regular price, zero, or a bad date", () => {
    expect(checkSale({ salePrice: "25000", saleUntil: "" }, 25000)).toMatchObject({ error: "Harga promo harus lebih rendah dari harga normal" });
    expect(checkSale({ salePrice: "0", saleUntil: "" }, 25000)).toMatchObject({ ok: false });
    expect(checkSale({ salePrice: "20000", saleUntil: "31/12/2026" }, 25000)).toMatchObject({ error: "Tanggal akhir promo tidak valid" });
  });

  it("reads the date part of the stored sale end for the date input", () => {
    expect(saleUntilInput("2026-12-31T16:59:59Z")).toBe("2026-12-31");
    expect(saleUntilInput(null)).toBe("");
  });
});
