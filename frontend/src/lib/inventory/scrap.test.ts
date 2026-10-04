import { describe, expect, it } from "vitest";
import { evaluateScrap } from "./scrap";

describe("evaluateScrap", () => {
  it("menerima qty dalam stok gudang dan sisa batch", () => {
    expect(evaluateScrap({ qty: 2, qtyAvailable: 10, batchRemaining: 2 })).toBeNull();
    expect(evaluateScrap({ qty: 10, qtyAvailable: 10 })).toBeNull();
  });

  it("menolak qty nol, melebihi stok, atau melebihi batch", () => {
    expect(evaluateScrap({ qty: 0, qtyAvailable: 10 })).toMatch(/lebih dari 0/);
    expect(evaluateScrap({ qty: 11, qtyAvailable: 10 })).toMatch(/tidak cukup/);
    expect(evaluateScrap({ qty: 3, qtyAvailable: 10, batchRemaining: 2 })).toMatch(/sisa batch/);
  });

  it("membandingkan setelah pembulatan 3 desimal", () => {
    expect(evaluateScrap({ qty: 0.1 + 0.2, qtyAvailable: 0.3 })).toBeNull();
  });
});
