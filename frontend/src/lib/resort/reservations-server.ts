/** Reservasi Resort: daftar, ketersediaan, pembuatan (tarif snapshot + folio awal), ubah kontak. */
import crypto from "crypto";
import { ApiError } from "@/lib/api/auth";
import { query, withTransaction } from "@/lib/db";
import { buildUpdateSet, planReservation, summarizeAvailability, type UnitRoom } from "./planning";
import { nightsBetween } from "./rates";
import { generateReservationCode, reservationSummary, validateStayDates } from "./reservation";
import type { ReservationCreateInput, ReservationPatch } from "./schemas";
import { loadActorName, loadBookedRooms, loadRoomTypes, loadSeasons, type ResortContext } from "./server";
import type { ReservationListRow } from "./types";

export interface ReservationFilters {
  status: string | null;
  from: string | null;
  to: string | null;
  search: string;
}

export async function listReservations(branchId: string, f: ReservationFilters): Promise<ReservationListRow[]> {
  const values: unknown[] = [branchId];
  const where: string[] = ["r.branch_id = $1"];
  if (f.status && f.status !== "all") { values.push(f.status); where.push(`r.status = $${values.length}`); }
  if (f.from && f.to) {
    values.push(f.from, f.to);
    // Reservasi yang bersinggungan dengan rentang tanggal
    where.push(`r.check_in < $${values.length}::date + 1 AND r.check_out > $${values.length - 1}::date`);
  }
  if (f.search) {
    values.push(`%${f.search}%`);
    where.push(`(r.guest_name ILIKE $${values.length} OR r.guest_phone ILIKE $${values.length} OR r.reservation_code ILIKE $${values.length})`);
  }
  return query<ReservationListRow>(
    `SELECT r.id, r.reservation_code, r.guest_name, r.guest_phone, r.guest_email,
            r.check_in::text AS check_in, r.check_out::text AS check_out, r.nights, r.adults, r.children,
            r.status, r.source, r.total::float8 AS total, r.notes, r.created_by_name, r.created_at,
            r.checked_in_at, r.checked_out_at,
            (SELECT COUNT(*) FROM resort.reservation_rooms rr WHERE rr.reservation_id = r.id)::int AS room_count,
            (SELECT string_agg(DISTINCT rr.room_type_name, ', ') FROM resort.reservation_rooms rr WHERE rr.reservation_id = r.id) AS room_types,
            COALESCE((SELECT SUM(CASE WHEN f.direction = 'debit' THEN f.amount ELSE -f.amount END)
                      FROM resort.folio_charges f WHERE f.reservation_id = r.id), 0)::float8 AS balance
     FROM resort.reservations r
     WHERE ${where.join(" AND ")}
     ORDER BY r.check_in DESC, r.created_at DESC
     LIMIT 300`,
    values
  );
}

function assertStayDates(checkIn: string, checkOut: string) {
  const invalid = validateStayDates(checkIn, checkOut);
  if (invalid) throw ApiError.badRequest(invalid);
}

/** Ketersediaan per tipe kamar untuk rentang menginap beserta musim tarif yang berlaku. */
export async function loadAvailability(branchId: string, checkIn: string, checkOut: string, excludeReservationId: string | null) {
  assertStayDates(checkIn, checkOut);
  const [types, seasons, booked, rooms] = await Promise.all([
    loadRoomTypes(branchId),
    loadSeasons(branchId, checkIn, checkOut),
    loadBookedRooms(branchId, checkIn, checkOut, excludeReservationId),
    query<UnitRoom>(
      `SELECT id, code, name, room_type_id, status FROM resort.rooms
       WHERE branch_id = $1 AND is_active AND status <> 'ditutup' ORDER BY code`,
      [branchId]
    ),
  ]);
  const data = summarizeAvailability({ types, rooms, booked, seasons, checkIn, checkOut });
  return { check_in: checkIn, check_out: checkOut, nights: nightsBetween(checkIn, checkOut), types: data, seasons };
}

/** Buat reservasi: cek stok per tipe, snapshot tarif per malam, catat tagihan kamar ke folio. */
export async function createReservation(ctx: ResortContext, body: ReservationCreateInput) {
  assertStayDates(body.check_in, body.check_out);
  const [types, seasons, unitCounts] = await Promise.all([
    loadRoomTypes(ctx.branchId),
    loadSeasons(ctx.branchId, body.check_in, body.check_out),
    query<{ room_type_id: string; total: number }>(
      `SELECT room_type_id, COUNT(*)::int AS total FROM resort.rooms
       WHERE branch_id = $1 AND is_active AND status <> 'ditutup' GROUP BY room_type_id`,
      [ctx.branchId]
    ),
  ]);
  const unitsByType = new Map(unitCounts.map((u) => [u.room_type_id, u.total]));
  const actorName = await loadActorName(ctx.user.id);

  const result = await withTransaction(async (client) => {
    // Same lock key as the Go service: bookings for one branch serialize, so
    // the stock check below sees every committed reservation.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('resort-booking:' || $1))`, [ctx.branchId]);
    const booked = await loadBookedRooms(ctx.branchId, body.check_in, body.check_out, null, client);
    const { lines, roomTotal, extraTotal, total, nights } = planReservation({ body, types, booked, seasons, unitsByType });
    let reservationId = "";
    let code = "";
    for (let attempt = 0; attempt < 5 && !reservationId; attempt += 1) {
      code = generateReservationCode();
      // A savepoint keeps the transaction usable when the code collides.
      await client.query("SAVEPOINT reservation_code");
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO resort.reservations
             (company_id, branch_id, reservation_code, access_token, guest_name, guest_phone, guest_email,
              check_in, check_out, nights, adults, children, status, source, room_total, extra_total,
              discount_amount, total, notes, special_request, created_by, created_by_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
           RETURNING id`,
          [ctx.companyId, ctx.branchId, code, crypto.randomBytes(24).toString("hex"),
           body.guest_name, body.guest_phone, body.guest_email ?? null, body.check_in, body.check_out,
           nights, body.adults, body.children, body.status, body.source, roomTotal, extraTotal,
           body.discount_amount, total, body.notes ?? null, body.special_request ?? null, ctx.user.id, actorName]
        );
        reservationId = rows[0].id;
        await client.query("RELEASE SAVEPOINT reservation_code");
      } catch (err) {
        // 23505 = kode reservasi bentrok → coba kode lain
        if ((err as { code?: string }).code !== "23505") throw err;
        await client.query("ROLLBACK TO SAVEPOINT reservation_code");
      }
    }
    if (!reservationId) throw new Error("Gagal membuat kode reservasi unik");

    for (const line of lines) {
      const roomName = line.roomId
        ? (await client.query<{ name: string }>(`SELECT name FROM resort.rooms WHERE id = $1`, [line.roomId])).rows[0]?.name ?? null
        : null;
      await client.query(
        `INSERT INTO resort.reservation_rooms
           (company_id, branch_id, reservation_id, room_type_id, room_id, room_type_name, room_name,
            nightly_rate, nights, extra_bed, subtotal, guest_name, rate_breakdown)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
        [ctx.companyId, ctx.branchId, reservationId, line.typeId, line.roomId, line.typeName, roomName,
         line.quote.nights > 0 ? Math.round(line.quote.room_subtotal / line.quote.nights) : 0,
         line.quote.nights, line.extraBed, line.quote.subtotal, line.guestName ?? body.guest_name,
         JSON.stringify(line.quote.breakdown)]
      );
    }

    // Folio: tagihan kamar (+ extra bed, − diskon) langsung tercatat
    const addCharge = (type: string, direction: string, description: string, amount: number) =>
      client.query(
        `INSERT INTO resort.folio_charges
           (company_id, branch_id, reservation_id, charge_type, direction, description, amount, created_by, created_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [ctx.companyId, ctx.branchId, reservationId, type, direction, description, amount, ctx.user.id, actorName]
      );
    if (roomTotal > 0) await addCharge("kamar", "debit", `Kamar ${lines.length} unit × ${nights} malam`, roomTotal);
    if (extraTotal > 0) await addCharge("extra-bed", "debit", `Extra bed × ${nights} malam`, extraTotal);
    if (body.discount_amount > 0) await addCharge("diskon", "kredit", "Diskon reservasi", body.discount_amount);

    return { id: reservationId, code, nights, total, rooms: lines.length };
  });

  return {
    data: { id: result.id, reservation_code: result.code, nights: result.nights, total: result.total },
    message: reservationSummary({
      code: result.code,
      guest: body.guest_name,
      nights: result.nights,
      rooms: result.rooms,
      total: result.total,
    }),
  };
}

/** Ubah kontak/catatan; null bila body kosong (tidak ada yang diubah). */
export async function updateReservation(branchId: string, id: string, body: ReservationPatch) {
  const params: unknown[] = [id, branchId];
  const sets = buildUpdateSet(body, params);
  if (sets.length === 0) return null;
  const rows = await query<{ id: string; reservation_code: string }>(
    `UPDATE resort.reservations SET ${sets.join(", ")}, updated_at = now()
     WHERE id = $1 AND branch_id = $2 RETURNING id, reservation_code`,
    params
  );
  if (rows.length === 0) throw ApiError.notFound("Reservasi tidak ditemukan");
  return rows[0];
}
