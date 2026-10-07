/** Master tipe kamar & unit kamar Resort (CRUD per cabang). */
import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { buildUpdateSet } from "./planning";
import type { RoomCreateInput, RoomPatch, RoomTypeCreateInput, RoomTypePatch } from "./schemas";
import { loadRoomTypes, loadSeasons, type ResortContext } from "./server";
import type { RoomRow } from "./types";

type Created = { id: string; code: string; name: string };

export async function listRoomTypesWithSeasons(branchId: string, includeInactive: boolean) {
  const [types, seasons] = await Promise.all([loadRoomTypes(branchId, !includeInactive), loadSeasons(branchId)]);
  return { types, seasons };
}

export async function createRoomType(ctx: ResortContext, body: RoomTypeCreateInput): Promise<Created> {
  const exists = await queryOne(
    `SELECT id FROM resort.room_types WHERE branch_id = $1 AND upper(code) = upper($2)`,
    [ctx.branchId, body.code]
  );
  if (exists) throw ApiError.conflict(`Kode tipe kamar "${body.code}" sudah dipakai`);
  const rows = await query<Created>(
    `INSERT INTO resort.room_types
       (company_id, branch_id, code, name, description, zone, capacity_adults, capacity_children,
        extra_bed_capacity, rate_weekday, rate_weekend, extra_bed_rate, amenities, sort_order, created_by)
     VALUES ($1, $2, upper($3), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING id, code, name`,
    [ctx.companyId, ctx.branchId, body.code, body.name, body.description ?? null, body.zone ?? null,
     body.capacity_adults, body.capacity_children, body.extra_bed_capacity, body.rate_weekday,
     body.rate_weekend, body.extra_bed_rate, body.amenities, body.sort_order, ctx.user.id]
  );
  return rows[0];
}

/** Ubah tipe kamar; null bila body kosong (tidak ada yang diubah). */
export async function updateRoomType(branchId: string, id: string, body: RoomTypePatch) {
  const current = await queryOne(`SELECT id FROM resort.room_types WHERE id = $1 AND branch_id = $2`, [id, branchId]);
  if (!current) throw ApiError.notFound("Tipe kamar tidak ditemukan");
  const params: unknown[] = [id];
  const sets = buildUpdateSet(body, params);
  if (sets.length === 0) return null;
  const rows = await query<Created>(
    `UPDATE resort.room_types SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 RETURNING id, code, name`,
    params
  );
  return rows[0];
}

/** Hapus tipe kamar; bila sudah dipakai reservasi cukup dinonaktifkan. Mengembalikan pesan untuk klien. */
export async function removeRoomType(branchId: string, id: string): Promise<string> {
  const current = await queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM resort.room_types WHERE id = $1 AND branch_id = $2`, [id, branchId]
  );
  if (!current) throw ApiError.notFound("Tipe kamar tidak ditemukan");
  const used = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM resort.reservation_rooms WHERE room_type_id = $1`, [id]
  );
  if (Number(used?.c) > 0) {
    await query(`UPDATE resort.room_types SET is_active = false, updated_at = now() WHERE id = $1`, [id]);
    return `Tipe kamar ${current.name} dinonaktifkan (sudah dipakai reservasi, riwayat dipertahankan)`;
  }
  await query(`DELETE FROM resort.room_types WHERE id = $1`, [id]);
  return `Tipe kamar ${current.name} dihapus`;
}

/** Unit kamar + status housekeeping + tamu yang sedang menempati. */
export async function listRooms(branchId: string, roomTypeId: string | null): Promise<RoomRow[]> {
  const params: unknown[] = [branchId];
  let filter = "";
  if (roomTypeId) { params.push(roomTypeId); filter = ` AND r.room_type_id = $${params.length}`; }
  return query<RoomRow>(
    `SELECT r.id, r.code, r.name, r.zone, r.status, r.notes, r.is_active,
            r.room_type_id, t.name AS room_type_name, t.code AS room_type_code,
            stay.reservation_id, stay.guest_name, stay.check_out::text AS occupied_until
     FROM resort.rooms r
     JOIN resort.room_types t ON t.id = r.room_type_id
     LEFT JOIN LATERAL (
       SELECT res.id AS reservation_id, res.guest_name, res.check_out
       FROM resort.reservation_rooms rr
       JOIN resort.reservations res ON res.id = rr.reservation_id
       WHERE rr.room_id = r.id AND res.status = 'check-in'
       ORDER BY res.check_in DESC LIMIT 1
     ) stay ON true
     WHERE r.branch_id = $1${filter}
     ORDER BY t.sort_order, t.name, r.code`,
    params
  );
}

export async function createRoom(ctx: ResortContext, body: RoomCreateInput): Promise<Created> {
  const type = await queryOne(`SELECT id FROM resort.room_types WHERE id = $1 AND branch_id = $2`, [body.room_type_id, ctx.branchId]);
  if (!type) throw ApiError.notFound("Tipe kamar tidak ditemukan");
  const exists = await queryOne(`SELECT id FROM resort.rooms WHERE branch_id = $1 AND upper(code) = upper($2)`, [ctx.branchId, body.code]);
  if (exists) throw ApiError.conflict(`Kode kamar "${body.code}" sudah dipakai`);
  const rows = await query<Created>(
    `INSERT INTO resort.rooms (company_id, branch_id, room_type_id, code, name, zone, notes, created_by)
     VALUES ($1, $2, $3, upper($4), $5, $6, $7, $8) RETURNING id, code, name`,
    [ctx.companyId, ctx.branchId, body.room_type_id, body.code, body.name, body.zone ?? null, body.notes ?? null, ctx.user.id]
  );
  return rows[0];
}

/** Ubah kamar / status housekeeping; null bila body kosong. */
export async function updateRoom(branchId: string, id: string, body: RoomPatch) {
  const current = await queryOne(`SELECT id FROM resort.rooms WHERE id = $1 AND branch_id = $2`, [id, branchId]);
  if (!current) throw ApiError.notFound("Kamar tidak ditemukan");
  const params: unknown[] = [id];
  const sets = buildUpdateSet(body, params);
  if (sets.length === 0) return null;
  const rows = await query<Created & { status: string }>(
    `UPDATE resort.rooms SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 RETURNING id, code, name, status`,
    params
  );
  return rows[0];
}

/** Hapus kamar; bila punya riwayat menginap cukup dinonaktifkan & ditutup. */
export async function removeRoom(branchId: string, id: string): Promise<string> {
  const current = await queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM resort.rooms WHERE id = $1 AND branch_id = $2`, [id, branchId]
  );
  if (!current) throw ApiError.notFound("Kamar tidak ditemukan");
  const used = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM resort.reservation_rooms WHERE room_id = $1`, [id]
  );
  if (Number(used?.c) > 0) {
    await query(`UPDATE resort.rooms SET is_active = false, status = 'ditutup', updated_at = now() WHERE id = $1`, [id]);
    return `Kamar ${current.name} dinonaktifkan (punya riwayat menginap)`;
  }
  await query(`DELETE FROM resort.rooms WHERE id = $1`, [id]);
  return `Kamar ${current.name} dihapus`;
}
