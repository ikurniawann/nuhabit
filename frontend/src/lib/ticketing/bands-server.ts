import "server-only";
// Registry gelang NFC venue + pairing Gelang Karyawan (Fase E ops).
// Status `dipakai` diatur alur kunjungan, `karyawan` oleh pairing staff
// pass — dari registry petugas hanya menandai tersedia/hilang/rusak.

import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import {
  BAND_STATUSES,
  normalizeNfcUid,
  requireNfcUid,
  type TicketingContext,
} from "./server";
import { conflictOnDuplicate, patchAssignments, splitTotalCount } from "./sql";

const BAND_COLUMNS = `id, nfc_uid, label, status, created_at, updated_at`;

export async function listBands(
  ctx: TicketingContext,
  filter: { q: string; status: string; page: number; limit: number }
) {
  const conditions: string[] = ["branch_id = $1", "company_id = $2"];
  const params: unknown[] = [ctx.branchId, ctx.companyId];
  if (filter.status && (BAND_STATUSES as readonly string[]).includes(filter.status)) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter.q) {
    params.push(`%${filter.q}%`);
    conditions.push(`(nfc_uid ILIKE $${params.length} OR label ILIKE $${params.length})`);
  }

  params.push(filter.limit, (filter.page - 1) * filter.limit);
  const rows = await query<Record<string, unknown> & { total_count: string }>(
    `SELECT ${BAND_COLUMNS}, COUNT(*) OVER() AS total_count
     FROM ticketing.ticket_bands
     WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return splitTotalCount(rows);
}

export const createBandSchema = z.object({
  nfc_uid: z.string().trim().min(1).max(80),
  label: z.string().trim().max(60).optional().nullable(),
});

export async function registerBand(
  ctx: TicketingContext,
  body: z.infer<typeof createBandSchema>
) {
  const uid = requireNfcUid(body.nfc_uid, "UID gelang tidak valid — scan ulang kartu/gelang");
  const duplicate = await queryOne<{ id: string; status: string }>(
    `SELECT id, status FROM ticketing.ticket_bands
     WHERE branch_id = $1 AND company_id = $2 AND nfc_uid = $3`,
    [ctx.branchId, ctx.companyId, uid]
  );
  if (duplicate) {
    throw ApiError.conflict(`Gelang sudah terdaftar (status: ${duplicate.status})`);
  }
  return queryOne(
    `INSERT INTO ticketing.ticket_bands
       (company_id, branch_id, nfc_uid, label, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${BAND_COLUMNS}`,
    [ctx.companyId, ctx.branchId, uid, body.label || null, ctx.user.id]
  );
}

export const updateBandSchema = z.object({
  label: z.string().trim().max(60).optional().nullable(),
  status: z.enum(BAND_STATUSES).optional(),
});

export async function updateBand(
  ctx: TicketingContext,
  id: string,
  body: z.infer<typeof updateBandSchema>
) {
  if (body.status === "dipakai") {
    throw ApiError.badRequest("Status 'dipakai' diatur otomatis oleh registrasi kunjungan");
  }
  if (body.status === "karyawan") {
    throw ApiError.badRequest("Status 'karyawan' diatur otomatis oleh pairing Gelang Karyawan");
  }

  const { assignments, values } = patchAssignments(
    {
      label: body.label === undefined ? undefined : body.label || null,
      status: body.status,
    },
    3
  );
  const rows = await query(
    `UPDATE ticketing.ticket_bands
     SET ${["updated_at = now()", ...assignments].join(", ")}
     WHERE id = $1 AND branch_id = $2 AND company_id = $3
       AND status NOT IN ('dipakai', 'karyawan')
     RETURNING ${BAND_COLUMNS}`,
    [id, ctx.branchId, ctx.companyId, ...values]
  );
  if (rows.length === 0) {
    throw ApiError.notFound(
      "Gelang tidak ditemukan, sedang dipakai kunjungan aktif, atau dipegang karyawan (cabut pairing dulu)"
    );
  }
  return rows[0];
}

// ── Gelang Karyawan (staff pass) ──────────────────────────────────────
// Pairing gelang NFC ↔ karyawan HRIS untuk akses gate gratis. Tabel hanya
// menunjuk hris.employees; gelang tetap aset venue.

interface StaffPassRow {
  id: string;
  band_id: string;
  nfc_uid: string;
  band_label: string | null;
  employee_id: string;
  full_name: string;
  nip: string | null;
  employee_active: boolean;
  created_at: string;
}

/** Daftar pass AKTIF venue ini (+ pencarian nama/NIP/UID). */
export function listStaffPasses(ctx: TicketingContext, q: string) {
  const params: unknown[] = [ctx.branchId, ctx.companyId];
  let where = `sp.branch_id = $1 AND sp.company_id = $2 AND sp.is_active = true`;
  if (q) {
    params.push(`%${q}%`, `%${normalizeNfcUid(q) || q}%`);
    where += ` AND (e.full_name ILIKE $3 OR e.nip ILIKE $3 OR b.nfc_uid ILIKE $4)`;
  }
  return query<StaffPassRow>(
    `SELECT sp.id, sp.band_id, b.nfc_uid, b.label AS band_label,
            sp.employee_id, e.full_name, e.nip,
            e.is_active AS employee_active, sp.created_at
     FROM ticketing.ticket_staff_passes sp
     JOIN ticketing.ticket_bands b ON b.id = sp.band_id
     JOIN hris.employees e ON e.id = sp.employee_id
     WHERE ${where}
     ORDER BY e.full_name
     LIMIT 200`,
    params
  );
}

export const pairStaffPassSchema = z.object({
  nfc_uid: z.string().trim().min(1).max(80),
  employee_id: z.string().uuid(),
});

/** Pasangkan gelang 'tersedia' ke karyawan aktif → status 'karyawan'. */
export async function pairStaffPass(
  ctx: TicketingContext,
  body: z.infer<typeof pairStaffPassSchema>
): Promise<{ id: string; employee: string }> {
  const uid = requireNfcUid(body.nfc_uid, "UID gelang tidak valid — scan ulang");
  const work = withTransaction(async (client) => {
    const bandResult = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM ticketing.ticket_bands
       WHERE branch_id = $1 AND company_id = $2 AND nfc_uid = $3
       FOR UPDATE`,
      [ctx.branchId, ctx.companyId, uid]
    );
    const band = bandResult.rows[0];
    if (!band) {
      throw ApiError.badRequest(`Gelang ${uid} belum terdaftar di registry — daftarkan dulu`);
    }
    if (band.status !== "tersedia") {
      throw ApiError.conflict(
        `Gelang berstatus "${band.status}" — hanya gelang tersedia yang bisa dipasangkan`
      );
    }

    const employeeResult = await client.query<{ full_name: string }>(
      `SELECT full_name FROM hris.employees
       WHERE id = $1 AND is_active = true`,
      [body.employee_id]
    );
    if (employeeResult.rows.length === 0) {
      throw ApiError.badRequest("Karyawan tidak ditemukan / nonaktif");
    }

    const existing = await client.query(
      `SELECT 1 FROM ticketing.ticket_staff_passes
       WHERE branch_id = $1 AND employee_id = $2 AND is_active = true`,
      [ctx.branchId, body.employee_id]
    );
    if (existing.rows.length > 0) {
      throw ApiError.conflict("Karyawan ini sudah memegang gelang — cabut dulu yang lama");
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO ticketing.ticket_staff_passes
         (company_id, branch_id, band_id, employee_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [ctx.companyId, ctx.branchId, band.id, body.employee_id, ctx.user.id]
    );
    await client.query(
      `UPDATE ticketing.ticket_bands
       SET status = 'karyawan', updated_at = now() WHERE id = $1`,
      [band.id]
    );
    return { id: inserted.rows[0].id, employee: employeeResult.rows[0].full_name };
  });
  // Race unique index pass aktif per gelang
  return conflictOnDuplicate(work, "Gelang/karyawan sudah terpasang — muat ulang daftar");
}

/**
 * Cabut pairing gelang karyawan: pass nonaktif (riwayat dipertahankan),
 * gelang kembali 'tersedia' sebagai stok kunjungan.
 */
export async function revokeStaffPass(ctx: TicketingContext, id: string) {
  await withTransaction(async (client) => {
    const passResult = await client.query<{ band_id: string }>(
      `UPDATE ticketing.ticket_staff_passes
       SET is_active = false, revoked_at = now(), revoked_by = $4,
           updated_at = now()
       WHERE id = $1 AND branch_id = $2 AND company_id = $3
         AND is_active = true
       RETURNING band_id`,
      [id, ctx.branchId, ctx.companyId, ctx.user.id]
    );
    if (passResult.rows.length === 0) {
      throw ApiError.notFound("Pairing tidak ditemukan / sudah dicabut");
    }
    await client.query(
      `UPDATE ticketing.ticket_bands
       SET status = 'tersedia', updated_at = now()
       WHERE id = $1 AND status = 'karyawan'`,
      [passResult.rows[0].band_id]
    );
  });
}
