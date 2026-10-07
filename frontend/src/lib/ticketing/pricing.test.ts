import { describe, expect, test } from "vitest";
import {
  isDateBlockedOnline,
  isValidCalendarDate,
  isVariantPriceComplete,
  resolveSeasonKind,
  resolveTicketPrice,
  resolveVariantPrice,
  type ProductDateRange,
} from "./pricing";

const high = (
  start: string,
  end: string,
  is_active = true
): ProductDateRange => ({
  date_kind: "high-season",
  start_date: start,
  end_date: end,
  is_active,
});

const blocked = (
  start: string,
  end: string,
  is_active = true
): ProductDateRange => ({
  date_kind: "blok-online",
  start_date: start,
  end_date: end,
  is_active,
});

describe("isValidCalendarDate", () => {
  test("menerima tanggal sah dan menolak tanggal palsu", () => {
    expect(isValidCalendarDate("2027-03-30")).toBe(true);
    expect(isValidCalendarDate("2027-02-30")).toBe(false);
    expect(isValidCalendarDate("30-03-2027")).toBe(false);
    expect(isValidCalendarDate("")).toBe(false);
  });
});

describe("resolveSeasonKind — kalender per ticket", () => {
  const dates = [high("2027-03-20", "2027-04-05"), blocked("2027-03-25", "2027-03-27")];

  test("dalam rentang high-season → high (inklusif dua ujung)", () => {
    expect(resolveSeasonKind("2027-03-20", dates)).toBe("high");
    expect(resolveSeasonKind("2027-04-05", dates)).toBe("high");
  });

  test("di luar semua rentang → regular", () => {
    expect(resolveSeasonKind("2027-03-19", dates)).toBe("regular");
    expect(resolveSeasonKind("2027-04-06", dates)).toBe("regular");
  });

  test("rentang blok-online TIDAK memengaruhi musim", () => {
    expect(resolveSeasonKind("2027-05-10", [blocked("2027-05-01", "2027-05-31")])).toBe(
      "regular"
    );
  });

  test("rentang nonaktif diabaikan", () => {
    expect(resolveSeasonKind("2027-03-25", [high("2027-03-20", "2027-04-05", false)])).toBe(
      "regular"
    );
  });

  test("tanggal tidak valid → throw", () => {
    expect(() => resolveSeasonKind("2027-13-01", dates)).toThrow();
  });
});

describe("isDateBlockedOnline", () => {
  const dates = [blocked("2027-12-31", "2028-01-01")];

  test("dalam rentang blok → true; di luar → false", () => {
    expect(isDateBlockedOnline("2027-12-31", dates)).toBe(true);
    expect(isDateBlockedOnline("2027-12-30", dates)).toBe(false);
  });

  test("rentang high-season tidak memblok online", () => {
    expect(isDateBlockedOnline("2027-06-01", [high("2027-06-01", "2027-06-30")])).toBe(
      false
    );
  });
});

describe("resolveVariantPrice — override kanal menang", () => {
  const variant = { price_regular: 100000, price_high: 150000 };

  test("tanpa override → harga varian sesuai musim", () => {
    expect(resolveVariantPrice({ variant, seasonKind: "regular" })).toBe(100000);
    expect(resolveVariantPrice({ variant, seasonKind: "high" })).toBe(150000);
  });

  test("override terisi → override menang", () => {
    const channelOverride = { price_regular: 90000, price_high: null };
    expect(
      resolveVariantPrice({ variant, channelOverride, seasonKind: "regular" })
    ).toBe(90000);
    // high kosong di override → jatuh ke harga varian
    expect(resolveVariantPrice({ variant, channelOverride, seasonKind: "high" })).toBe(
      150000
    );
  });

  test("harga belum diisi → null (wajib tolak, jangan menebak)", () => {
    expect(
      resolveVariantPrice({
        variant: { price_regular: null, price_high: null },
        seasonKind: "regular",
      })
    ).toBeNull();
  });

  test("harga 0 = comp sah, bukan lubang harga", () => {
    expect(
      resolveVariantPrice({
        variant: { price_regular: 0, price_high: 0 },
        seasonKind: "regular",
      })
    ).toBe(0);
  });
});

describe("resolveTicketPrice — resolusi lengkap", () => {
  const dates = [
    high("2027-03-20", "2027-04-05"),
    blocked("2027-03-25", "2027-03-27"),
  ];
  const variant = { price_regular: 100000, price_high: 150000 };

  test("walk-in di tanggal high → harga high", () => {
    const r = resolveTicketPrice({
      visitDate: "2027-03-25",
      isOnlineChannel: false,
      dates,
      variant,
    });
    expect(r).toEqual({ ok: true, price: 150000, seasonKind: "high" });
  });

  test("kanal online di tanggal blok → ditolak", () => {
    const r = resolveTicketPrice({
      visitDate: "2027-03-25",
      isOnlineChannel: true,
      dates,
      variant,
    });
    expect(r).toEqual({ ok: false, reason: "tanggal-diblok" });
  });

  test("kanal online di luar blok → jalan normal", () => {
    const r = resolveTicketPrice({
      visitDate: "2027-03-28",
      isOnlineChannel: true,
      dates,
      variant,
    });
    expect(r).toEqual({ ok: true, price: 150000, seasonKind: "high" });
  });

  test("harga musim kosong → harga-belum-diisi", () => {
    const r = resolveTicketPrice({
      visitDate: "2027-03-25",
      isOnlineChannel: false,
      dates,
      variant: { price_regular: 100000, price_high: null },
    });
    expect(r).toEqual({ ok: false, reason: "harga-belum-diisi" });
  });
});

describe("isVariantPriceComplete — guard distribusi", () => {
  test("lengkap langsung di varian", () => {
    expect(isVariantPriceComplete({ price_regular: 10, price_high: 20 })).toBe(true);
  });

  test("lubang di varian tertutup override kanal", () => {
    expect(
      isVariantPriceComplete(
        { price_regular: 10, price_high: null },
        { price_regular: null, price_high: 25 }
      )
    ).toBe(true);
  });

  test("masih berlubang → false", () => {
    expect(isVariantPriceComplete({ price_regular: 10, price_high: null })).toBe(false);
  });
});
