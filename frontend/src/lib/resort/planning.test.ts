import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/auth";
import { buildUpdateSet, occupancySummary, planReservation, summarizeAvailability, type BookedRow } from "./planning";
import type { RoomTypeRow } from "./types";

const type = (over: Partial<RoomTypeRow> = {}): RoomTypeRow => ({
  id: "t1", code: "CAB", name: "Cabin", description: null, zone: null,
  capacity_adults: 2, capacity_children: 0, extra_bed_capacity: 1,
  rate_weekday: 1_000_000, rate_weekend: 1_500_000, extra_bed_rate: 200_000,
  amenities: [], is_active: true, sort_order: 0, room_count: 2, ...over,
});
const room = (id: string, typeId = "t1") => ({ id, code: id.toUpperCase(), name: `Kamar ${id}`, room_type_id: typeId, status: "siap" });
const booking = (over: Partial<BookedRow>): BookedRow => ({
  room_type_id: "t1", room_id: null, check_in: "2026-10-05", check_out: "2026-10-07", reservation_id: "r1", ...over,
});

describe("summarizeAvailability", () => {
  // 2026-10-05 Senin, 06 Selasa, 07 Rabu
  it("menghitung terpakai per malam (check-out tidak memblokir) dan sisa minimum", () => {
    const [cabin] = summarizeAvailability({
      types: [type()],
      rooms: [room("a"), room("b")],
      booked: [booking({ room_id: "a" })],
      seasons: [],
      checkIn: "2026-10-06",
      checkOut: "2026-10-08",
    });
    expect(cabin.per_night).toEqual([
      { date: "2026-10-06", rooms: 2, booked: 1, available: 1 },
      { date: "2026-10-07", rooms: 2, booked: 0, available: 2 },
    ]);
    expect(cabin.available).toBe(1);
    expect(cabin.free_rooms.map((r) => r.id)).toEqual(["b"]);
    expect(cabin.quote.nights).toBe(2);
  });

  it("tanpa malam: sisa = jumlah unit", () => {
    const [cabin] = summarizeAvailability({
      types: [type()], rooms: [room("a")], booked: [], seasons: [], checkIn: "2026-10-06", checkOut: "2026-10-06",
    });
    expect(cabin.available).toBe(1);
  });
});

describe("planReservation", () => {
  const base = { check_in: "2026-10-05", check_out: "2026-10-07", discount_amount: 0 };
  const units = new Map([["t1", 2]]);

  it("satu baris per unit; room_id hanya di unit pertama; total dikurangi diskon", () => {
    const plan = planReservation({
      body: { ...base, discount_amount: 100_000, rooms: [{ room_type_id: "t1", qty: 2, extra_bed: 1, room_id: "a" }] },
      types: [type()], booked: [], unitsByType: units, seasons: [],
    });
    expect(plan.lines).toHaveLength(2);
    expect(plan.lines.map((l) => l.roomId)).toEqual(["a", null]);
    expect(plan.nights).toBe(2);
    expect(plan.roomTotal).toBe(4_000_000);
    expect(plan.extraTotal).toBe(800_000);
    expect(plan.total).toBe(4_700_000);
  });

  it("menolak bila stok tipe tidak cukup (409) dan extra bed melebihi kapasitas (400)", () => {
    expect(() =>
      planReservation({
        body: { ...base, rooms: [{ room_type_id: "t1", qty: 2, extra_bed: 0 }] },
        types: [type()], booked: [booking({})], unitsByType: units, seasons: [],
      })
    ).toThrow(expect.objectContaining({ status: 409 }));
    expect(() =>
      planReservation({
        body: { ...base, rooms: [{ room_type_id: "t1", qty: 1, extra_bed: 3 }] },
        types: [type()], booked: [], unitsByType: units, seasons: [],
      })
    ).toThrow(ApiError);
  });

  it("tipe tidak aktif/tidak ada → 404", () => {
    expect(() =>
      planReservation({
        body: { ...base, rooms: [{ room_type_id: "x", qty: 1, extra_bed: 0 }] },
        types: [type()], booked: [], unitsByType: units, seasons: [],
      })
    ).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe("occupancySummary & buildUpdateSet", () => {
  it("okupansi satu desimal; tanpa kamar = 0", () => {
    expect(occupancySummary({ rooms: [{ guest_name: "A" }, { guest_name: null }, { guest_name: null }], arrivals: 1, departures: 0 }))
      .toEqual({ rooms_total: 3, occupied: 1, vacant: 2, occupancy_pct: 33.3, arrivals: 1, departures: 0 });
    expect(occupancySummary({ rooms: [], arrivals: 0, departures: 0 }).occupancy_pct).toBe(0);
  });

  it("klausa SET melanjutkan nomor parameter dan melewati undefined", () => {
    const params: unknown[] = ["id", "branch"];
    expect(buildUpdateSet({ name: "A", zone: undefined, notes: null }, params)).toEqual(["name = $3", "notes = $4"]);
    expect(params).toEqual(["id", "branch", "A", null]);
  });
});
