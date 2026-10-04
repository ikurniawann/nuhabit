import { describe, expect, it } from "vitest";
import {
  blocksInventory, canTransition, chargeDirection, folioBalance, folioTotals,
  generateReservationCode, RESERVATION_CODE_PATTERN, validateStayDates,
} from "./reservation";

describe("resort reservation", () => {
  it("kode reservasi sesuai pola & tanpa huruf ambigu", () => {
    const code = generateReservationCode();
    expect(RESERVATION_CODE_PATTERN.test(code)).toBe(true);
    expect(code.slice(4)).not.toMatch(/[IO01]/);
  });

  it("transisi status: hanya alur yang masuk akal", () => {
    expect(canTransition("menunggu-bayar", "terkonfirmasi")).toBe(true);
    expect(canTransition("terkonfirmasi", "check-in")).toBe(true);
    expect(canTransition("check-in", "check-out")).toBe(true);
    expect(canTransition("menunggu-bayar", "check-in")).toBe(false);
    expect(canTransition("check-out", "check-in")).toBe(false);
    expect(canTransition("dibatalkan", "terkonfirmasi")).toBe(false);
  });

  it("status yang masih memakai kamar", () => {
    expect(blocksInventory("terkonfirmasi")).toBe(true);
    expect(blocksInventory("check-in")).toBe(true);
    expect(blocksInventory("check-out")).toBe(false);
    expect(blocksInventory("dibatalkan")).toBe(false);
  });

  it("arah biaya folio", () => {
    expect(chargeDirection("kamar")).toBe("debit");
    expect(chargeDirection("fnb")).toBe("debit");
    expect(chargeDirection("pembayaran")).toBe("kredit");
    expect(chargeDirection("diskon")).toBe("kredit");
  });

  it("saldo folio = tagihan − pembayaran", () => {
    const lines = [
      { direction: "debit" as const, amount: 5_500_000 },
      { direction: "debit" as const, amount: "350000" },
      { direction: "kredit" as const, amount: 3_000_000 },
    ];
    expect(folioBalance(lines)).toBe(2_850_000);
    expect(folioTotals(lines)).toEqual({ charges: 5_850_000, payments: 3_000_000, balance: 2_850_000 });
    expect(folioBalance([])).toBe(0);
  });

  it("validasi tanggal menginap", () => {
    expect(validateStayDates("2026-09-10", "2026-09-12")).toBeNull();
    expect(validateStayDates("2026-09-12", "2026-09-12")).toMatch(/setelah check-in/);
    expect(validateStayDates("10-09-2026", "2026-09-12")).toMatch(/Format/);
  });
});
