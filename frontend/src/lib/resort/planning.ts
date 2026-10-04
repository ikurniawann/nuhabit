/**
 * Perhitungan murni modul Resort: ketersediaan per tipe kamar, rencana baris
 * reservasi (cek stok + penawaran harga), ringkasan okupansi, dan klausa
 * UPDATE dari body PATCH yang sudah divalidasi zod.
 */
import { ApiError } from "@/lib/api/auth";
import { eachNight, quoteStay, type RateSeason, type StayQuote } from "./rates";
import type { ReservationCreateInput } from "./schemas";
import type { RoomTypeRow } from "./types";

export interface BookedRow { room_type_id: string; room_id: string | null; check_in: string; check_out: string; reservation_id: string }
export interface UnitRoom { id: string; code: string; name: string; room_type_id: string; status: string }

/** Ketersediaan tiap tipe: unit, terpakai per malam, sisa minimum, kamar bebas, dan harga 1 kamar. */
export function summarizeAvailability(input: {
  types: readonly RoomTypeRow[];
  rooms: readonly UnitRoom[];
  booked: readonly BookedRow[];
  seasons: readonly RateSeason[];
  checkIn: string;
  checkOut: string;
}) {
  const nights = eachNight(input.checkIn, input.checkOut);
  const busyRoomIds = new Set(input.booked.map((b) => b.room_id).filter((id): id is string => Boolean(id)));
  return input.types.map((type) => {
    const unitRooms = input.rooms.filter((r) => r.room_type_id === type.id);
    const bookedForType = input.booked.filter((b) => b.room_type_id === type.id);
    const perNight = nights.map((date) => {
      const used = bookedForType.filter((b) => date >= b.check_in && date < b.check_out).length;
      return { date, rooms: unitRooms.length, booked: used, available: Math.max(0, unitRooms.length - used) };
    });
    return {
      ...type,
      rooms_total: unitRooms.length,
      available: perNight.length ? Math.min(...perNight.map((n) => n.available)) : unitRooms.length,
      per_night: perNight,
      free_rooms: unitRooms.filter((r) => !busyRoomIds.has(r.id)).map(({ id, code, name, status }) => ({ id, code, name, status })),
      quote: quoteStay({ type, checkIn: input.checkIn, checkOut: input.checkOut, seasons: input.seasons }),
    };
  });
}

export interface ReservationLine {
  typeId: string;
  typeName: string;
  extraBed: number;
  guestName: string | null;
  roomId: string | null;
  quote: StayQuote;
}

/**
 * Pecah permintaan kamar menjadi satu baris per unit setelah cek stok per tipe
 * (unit aktif − yang sudah dipesan ≥ permintaan) dan batas extra bed.
 */
export function planReservation(input: {
  body: Pick<ReservationCreateInput, "rooms" | "check_in" | "check_out" | "discount_amount">;
  types: readonly RoomTypeRow[];
  booked: readonly BookedRow[];
  unitsByType: ReadonlyMap<string, number>;
  seasons: readonly RateSeason[];
}) {
  const { body } = input;
  const typeById = new Map(input.types.map((t) => [t.id, t]));
  const lines: ReservationLine[] = [];
  for (const req of body.rooms) {
    const type = typeById.get(req.room_type_id);
    if (!type) throw ApiError.notFound("Tipe kamar tidak ditemukan atau tidak aktif");
    const already = input.booked.filter((b) => b.room_type_id === req.room_type_id).length;
    const requested = body.rooms.filter((r) => r.room_type_id === req.room_type_id).reduce((s, r) => s + r.qty, 0);
    const total = input.unitsByType.get(req.room_type_id) ?? 0;
    if (already + requested > total) {
      throw ApiError.conflict(`${type.name}: sisa ${Math.max(0, total - already)} kamar untuk tanggal tersebut, diminta ${requested}`);
    }
    if (req.extra_bed > Number(type.extra_bed_capacity ?? 0)) {
      throw ApiError.badRequest(`${type.name}: maksimal ${type.extra_bed_capacity} extra bed per kamar`);
    }
    const quote = quoteStay({ type, checkIn: body.check_in, checkOut: body.check_out, extraBed: req.extra_bed, seasons: input.seasons });
    for (let i = 0; i < req.qty; i += 1) {
      lines.push({
        typeId: req.room_type_id, typeName: type.name, extraBed: req.extra_bed,
        guestName: req.guest_name ?? null, roomId: i === 0 ? req.room_id ?? null : null, quote,
      });
    }
  }
  const roomTotal = lines.reduce((s, l) => s + l.quote.room_subtotal, 0);
  const extraTotal = lines.reduce((s, l) => s + l.quote.extra_bed_total, 0);
  return {
    lines,
    roomTotal,
    extraTotal,
    total: Math.max(0, roomTotal + extraTotal - body.discount_amount),
    nights: lines[0]?.quote.nights ?? 0,
  };
}

/** Okupansi papan front office: kamar berpenghuni = ada tamu check-in. */
export function occupancySummary(input: {
  rooms: readonly { guest_name: string | null }[];
  arrivals: number;
  departures: number;
}) {
  const total = input.rooms.length;
  const occupied = input.rooms.filter((r) => r.guest_name).length;
  return {
    rooms_total: total,
    occupied,
    vacant: total - occupied,
    occupancy_pct: total ? Math.round((occupied / total) * 1000) / 10 : 0,
    arrivals: input.arrivals,
    departures: input.departures,
  };
}

/**
 * `SET a = $n, b = $n+1` dari body PATCH (kunci = kolom, sudah dibatasi skema
 * zod). Nilai undefined dilewati; `params` sudah berisi parameter sebelumnya.
 */
export function buildUpdateSet(body: Record<string, unknown>, params: unknown[]): string[] {
  const sets: string[] = [];
  for (const [column, value] of Object.entries(body)) {
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }
  return sets;
}
