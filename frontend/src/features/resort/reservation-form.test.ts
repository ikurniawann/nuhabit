import { describe, expect, it } from "vitest";
import type { AvailabilityType } from "@/lib/resort/types";
import { nightLabel, pickedLines, reservationTotal } from "./reservation-form";

const type = { id: "t1", extra_bed_rate: 100_000, quote: { room_subtotal: 2_000_000, nights: 2 } } as unknown as AvailabilityType;

describe("reservation form", () => {
  it("subtotal = (tarif menginap + extra bed × malam) × unit; pilihan nol dilewati", () => {
    const lines = pickedLines([type], { t1: { qty: 2, extraBed: 1 } });
    expect(lines).toHaveLength(1);
    expect(lines[0].subtotal).toBe((2_000_000 + 200_000) * 2);
    expect(pickedLines([type], { t1: { qty: 0, extraBed: 1 } })).toEqual([]);
  });

  it("total setelah diskon tidak negatif; label malam DD/MM", () => {
    expect(reservationTotal([{ subtotal: 100 }, { subtotal: 50 }], 30)).toBe(120);
    expect(reservationTotal([{ subtotal: 100 }], 500)).toBe(0);
    expect(nightLabel({ date: "2026-10-09", weekend: true })).toBe("09/10 (WE)");
  });
});
