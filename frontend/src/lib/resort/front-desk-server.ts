/** Front office Resort: papan harian, transisi status reservasi, dan baris folio. */
import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { formatRupiah } from "@/lib/format";
import { occupancySummary } from "./planning";
import {
  RESERVATION_STATUS_LABELS, canTransition, chargeDirection, folioBalance, folioTotals, type ReservationStatus,
} from "./reservation";
import type { FolioChargeInput, StatusChangeInput } from "./schemas";
import { loadActorName, type ResortContext } from "./server";
import type { FrontOfficeBoard, ReservationListRow } from "./types";

const LIST_COLUMNS = `r.id, r.reservation_code, r.guest_name, r.guest_phone, r.status, r.source,
  r.check_in::text AS check_in, r.check_out::text AS check_out, r.nights, r.adults, r.children,
  r.total::float8 AS total, r.special_request,
  (SELECT COUNT(*) FROM resort.reservation_rooms rr WHERE rr.reservation_id = r.id)::int AS room_count,
  (SELECT string_agg(COALESCE(rr.room_name, rr.room_type_name), ', ' ORDER BY rr.created_at)
     FROM resort.reservation_rooms rr WHERE rr.reservation_id = r.id) AS rooms_label,
  COALESCE((SELECT SUM(CASE WHEN f.direction = 'debit' THEN f.amount ELSE -f.amount END)
            FROM resort.folio_charges f WHERE f.reservation_id = r.id), 0)::float8 AS balance`;

/** Kedatangan, keberangkatan, tamu menginap, okupansi, dan status kamar pada satu tanggal. */
export async function loadFrontOfficeBoard(branchId: string, date: string): Promise<FrontOfficeBoard> {
  const [arrivals, departures, inHouse, rooms] = await Promise.all([
    query<ReservationListRow>(
      `SELECT ${LIST_COLUMNS} FROM resort.reservations r
       WHERE r.branch_id = $1 AND r.check_in = $2::date
         AND r.status IN ('menunggu-bayar', 'terkonfirmasi')
       ORDER BY r.created_at`,
      [branchId, date]
    ),
    query<ReservationListRow>(
      `SELECT ${LIST_COLUMNS} FROM resort.reservations r
       WHERE r.branch_id = $1 AND r.check_out = $2::date AND r.status = 'check-in'
       ORDER BY r.created_at`,
      [branchId, date]
    ),
    query<ReservationListRow>(
      `SELECT ${LIST_COLUMNS} FROM resort.reservations r
       WHERE r.branch_id = $1 AND r.status = 'check-in'
       ORDER BY r.check_out, r.guest_name`,
      [branchId]
    ),
    query<FrontOfficeBoard["rooms"][number]>(
      `SELECT r.id, r.code, r.name, r.status, r.zone, t.name AS room_type_name,
              stay.guest_name, stay.check_out::text AS occupied_until
       FROM resort.rooms r
       JOIN resort.room_types t ON t.id = r.room_type_id
       LEFT JOIN LATERAL (
         SELECT res.guest_name, res.check_out FROM resort.reservation_rooms rr
         JOIN resort.reservations res ON res.id = rr.reservation_id
         WHERE rr.room_id = r.id AND res.status = 'check-in' LIMIT 1
       ) stay ON true
       WHERE r.branch_id = $1 AND r.is_active
       ORDER BY t.sort_order, t.name, r.code`,
      [branchId]
    ),
  ]);
  return {
    date,
    arrivals,
    departures,
    in_house: inHouse,
    rooms,
    summary: occupancySummary({ rooms, arrivals: arrivals.length, departures: departures.length }),
  };
}

const ACTION_TO_STATUS: Record<StatusChangeInput["action"], ReservationStatus> = {
  konfirmasi: "terkonfirmasi",
  "check-in": "check-in",
  "check-out": "check-out",
  batal: "dibatalkan",
  "no-show": "no-show",
};

/**
 * Ubah status reservasi dalam satu transaksi. Check-in wajib menetapkan unit
 * kamar untuk setiap baris; check-out menolak folio bersaldo kecuali `force`
 * (alasan dicatat) dan menandai kamar 'kotor' untuk housekeeping. Galat
 * dilempar sebagai ApiError sehingga seluruh perubahan dibatalkan.
 */
export async function changeReservationStatus(ctx: ResortContext, id: string, body: StatusChangeInput) {
  const next = ACTION_TO_STATUS[body.action];
  const actorName = await loadActorName(ctx.user.id);

  const data = await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; status: ReservationStatus; reservation_code: string; guest_name: string }>(
      `SELECT id, status, reservation_code, guest_name FROM resort.reservations
       WHERE id = $1 AND branch_id = $2 FOR UPDATE`,
      [id, ctx.branchId]
    );
    const reservation = rows[0];
    if (!reservation) throw ApiError.notFound("Reservasi tidak ditemukan");
    if (!canTransition(reservation.status, next)) {
      throw ApiError.conflict(
        `Tidak bisa mengubah status dari "${RESERVATION_STATUS_LABELS[reservation.status]}" ke "${RESERVATION_STATUS_LABELS[next]}"`
      );
    }

    if (next === "check-in") {
      for (const a of body.assignments ?? []) {
        const room = await client.query<{ id: string; name: string }>(
          `SELECT id, name FROM resort.rooms WHERE id = $1 AND branch_id = $2 AND is_active AND status <> 'ditutup'`,
          [a.room_id, ctx.branchId]
        );
        if (!room.rows[0]) throw ApiError.badRequest("Kamar tujuan tidak tersedia");
        // Kamar tidak boleh dipakai reservasi lain yang sedang menginap
        const busy = await client.query(
          `SELECT 1 FROM resort.reservation_rooms rr JOIN resort.reservations r ON r.id = rr.reservation_id
           WHERE rr.room_id = $1 AND r.status = 'check-in' AND r.id <> $2 LIMIT 1`,
          [a.room_id, id]
        );
        if (busy.rows[0]) throw ApiError.conflict(`Kamar ${room.rows[0].name} sedang ditempati tamu lain`);
        await client.query(
          `UPDATE resort.reservation_rooms SET room_id = $2, room_name = $3
           WHERE id = $1 AND reservation_id = $4`,
          [a.reservation_room_id, a.room_id, room.rows[0].name, id]
        );
      }
      const unassigned = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM resort.reservation_rooms WHERE reservation_id = $1 AND room_id IS NULL`,
        [id]
      );
      if (Number(unassigned.rows[0]?.c) > 0) {
        throw ApiError.badRequest("Tetapkan unit kamar untuk semua baris reservasi sebelum check-in");
      }
    }

    if (next === "check-out") {
      const folio = await client.query<{ direction: "debit" | "kredit"; amount: string }>(
        `SELECT direction, amount FROM resort.folio_charges WHERE reservation_id = $1`, [id]
      );
      const balance = folioBalance(folio.rows);
      if (balance > 0 && !body.force) {
        throw ApiError.conflict(`Folio masih bersaldo ${formatRupiah(balance)} — lunasi dulu atau centang lanjutkan dengan catatan`);
      }
      await client.query(
        `UPDATE resort.rooms SET status = 'kotor', updated_at = now()
         WHERE id IN (SELECT room_id FROM resort.reservation_rooms WHERE reservation_id = $1 AND room_id IS NOT NULL)`,
        [id]
      );
    }

    if (next === "dibatalkan" || next === "no-show") {
      await client.query(
        `UPDATE resort.reservations SET cancelled_at = now(), cancel_reason = $2 WHERE id = $1`,
        [id, body.reason ?? null]
      );
    }

    const stamp =
      next === "check-in" ? ", checked_in_at = now()"
      : next === "check-out" ? ", checked_out_at = now()"
      : next === "terkonfirmasi" ? ", paid_at = COALESCE(paid_at, now())" : "";
    await client.query(
      `UPDATE resort.reservations SET status = $2${stamp}, updated_at = now() WHERE id = $1`,
      [id, next]
    );
    if (next === "check-out" && body.force && body.reason) {
      // Check-out dengan sisa tagihan → alasan disimpan sebagai catatan reservasi
      await client.query(
        `UPDATE resort.reservations
         SET notes = COALESCE(notes || E'\n', '') || $2, updated_at = now() WHERE id = $1`,
        [id, `Check-out dengan saldo terbuka (${actorName}): ${body.reason}`]
      );
    }
    return { id, status: next, code: reservation.reservation_code, guest: reservation.guest_name };
  });

  return { data, message: `${data.code} — ${data.guest}: ${RESERVATION_STATUS_LABELS[data.status]}` };
}

/** Tambah baris folio; arah debit/kredit ditentukan jenisnya supaya kasir tidak salah tanda. */
export async function addFolioCharge(ctx: ResortContext, id: string, body: FolioChargeInput) {
  const reservation = await queryOne<{ id: string; status: string }>(
    `SELECT id, status FROM resort.reservations WHERE id = $1 AND branch_id = $2`, [id, ctx.branchId]
  );
  if (!reservation) throw ApiError.notFound("Reservasi tidak ditemukan");
  if (reservation.status === "dibatalkan") throw ApiError.conflict("Reservasi sudah dibatalkan");

  const actorName = await loadActorName(ctx.user.id);
  const direction = chargeDirection(body.charge_type);
  const rows = await query(
    `INSERT INTO resort.folio_charges
       (company_id, branch_id, reservation_id, charge_type, direction, description, amount, payment_method, created_by, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, charge_type, direction, description, amount::float8 AS amount, created_at`,
    [ctx.companyId, ctx.branchId, id, body.charge_type, direction, body.description, body.amount,
     body.payment_method ?? null, ctx.user.id, actorName]
  );
  const folio = await query<{ direction: "debit" | "kredit"; amount: number }>(
    `SELECT direction, amount::float8 AS amount FROM resort.folio_charges WHERE reservation_id = $1`, [id]
  );
  const totals = folioTotals(folio);
  return {
    data: { charge: rows[0], totals },
    message: direction === "kredit"
      ? `Pembayaran ${formatRupiah(body.amount)} dicatat — sisa ${formatRupiah(totals.balance)}`
      : `Biaya ${body.description} ditambahkan — saldo ${formatRupiah(totals.balance)}`,
  };
}
