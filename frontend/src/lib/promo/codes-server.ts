// EPIC-032 A3 — kode di bawah campaign: kode publik tunggal, batch voucher
// sekali pakai (usage_limit=1), sinkron jumlah voucher, edit/hapus kode.
// Rename / hapus hanya boleh selama usage_count = 0.
import type { PoolClient } from "pg";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import type { CodeCreateInput, CodePatch } from "./campaign-schema";
import { fillUniqueCodes, inferPrefix } from "./campaign-rules";
import { assertCampaign, isUniqueViolation } from "./campaigns-server";
import { generateVoucherCode, type PromoVenue } from "./server";

export interface CodeRow {
  id: string;
  code: string;
  usage_limit: number | null;
  usage_count: number;
  is_active: boolean;
  created_at: string;
}

const DUPLICATE_CODE = "Kode sudah dipakai — pilih kode lain";

export async function listCodes(venue: PromoVenue, campaignId: string): Promise<CodeRow[]> {
  await assertCampaign(venue, campaignId);
  return query<CodeRow>(
    `SELECT id, code, usage_limit, usage_count, is_active, created_at
     FROM promo.promo_codes
     WHERE campaign_id = $1
     ORDER BY created_at DESC, code
     LIMIT 2000`,
    [campaignId]
  );
}

/** Sisipkan `count` voucher sekali pakai ber-prefix; tabrakan diisi ulang (maks 6 ronde). */
function insertVoucherBatch(client: PoolClient, venue: PromoVenue, campaignId: string, prefix: string, count: number, verb: string) {
  return fillUniqueCodes({
    need: count,
    generate: () => generateVoucherCode(prefix),
    insert: async (candidates) => {
      const inserted = await client.query<{ code: string }>(
        `INSERT INTO promo.promo_codes
           (company_id, branch_id, campaign_id, code, usage_limit)
         SELECT $1, $2, $3, unnest($4::text[]), 1
         ON CONFLICT (branch_id, code) DO NOTHING
         RETURNING code`,
        [venue.companyId, venue.branchId, campaignId, candidates]
      );
      return inserted.rows.map((r) => r.code);
    },
    shortMessage: (created, need) => `Hanya ${created}/${need} kode berhasil ${verb} — coba prefix lain`,
  });
}

/** Satu kode publik (`single`) atau batch voucher (`batch`). */
export async function createCodes(venue: PromoVenue, campaignId: string, body: CodeCreateInput) {
  await assertCampaign(venue, campaignId);
  if (body.mode === "single") {
    try {
      const rows = await query<CodeRow>(
        `INSERT INTO promo.promo_codes
           (company_id, branch_id, campaign_id, code, usage_limit)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, code, usage_limit, usage_count, is_active, created_at`,
        [venue.companyId, venue.branchId, campaignId, body.code.toUpperCase(), body.usage_limit]
      );
      return { mode: "single" as const, code: rows[0] };
    } catch (err) {
      if (isUniqueViolation(err)) throw ApiError.conflict(DUPLICATE_CODE);
      throw err;
    }
  }
  const codes = await withTransaction((client) =>
    insertVoucherBatch(client, venue, campaignId, body.prefix.toUpperCase(), body.count, "dibuat")
  );
  return { mode: "batch" as const, count: codes.length, codes };
}

/**
 * Samakan jumlah voucher campaign dengan `targetCount` (hanya bila belum ada
 * yang terpakai): kurangi = hapus yang terbaru, tambah = generate dengan
 * prefix yang diberikan atau prefix kode lama.
 */
export async function syncVoucherCount(venue: PromoVenue, campaignId: string, targetCount: number, prefixInput?: string) {
  await assertCampaign(venue, campaignId);
  const usage = await queryOne<{ captured: string; used_codes: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM promo.promo_redemptions r
         WHERE r.campaign_id = $1 AND r.status = 'captured') AS captured,
       (SELECT COUNT(*)::text FROM promo.promo_codes c
         WHERE c.campaign_id = $1 AND c.usage_count > 0) AS used_codes`,
    [campaignId]
  );
  if (Number(usage?.captured) > 0 || Number(usage?.used_codes) > 0) {
    throw ApiError.conflict("Sudah ada voucher terpakai — jumlah tidak bisa diubah");
  }

  const existing = await query<{ id: string; code: string }>(
    `SELECT id, code FROM promo.promo_codes
     WHERE campaign_id = $1 AND branch_id = $2 AND company_id = $3
     ORDER BY created_at DESC, code`,
    [campaignId, venue.branchId, venue.companyId]
  );
  const currentCount = existing.length;
  if (targetCount === currentCount) {
    return { result: { count: currentCount, added: 0, removed: 0 }, message: "Jumlah voucher tidak berubah" };
  }

  if (targetCount < currentCount) {
    const toRemove = currentCount - targetCount;
    const ids = existing.slice(0, toRemove).map((row) => row.id);
    await withTransaction(async (client) => {
      await client.query(
        `DELETE FROM promo.promo_redemptions
         WHERE code_id = ANY($1::uuid[]) AND status IN ('held', 'released')`,
        [ids]
      );
      await client.query(
        `DELETE FROM promo.promo_codes
         WHERE id = ANY($1::uuid[]) AND usage_count = 0`,
        [ids]
      );
    });
    return { result: { count: targetCount, added: 0, removed: toRemove }, message: `${toRemove} voucher dihapus` };
  }

  const prefix = (prefixInput?.toUpperCase() || inferPrefix(existing.map((row) => row.code)) || "").trim();
  if (!/^[A-Z0-9]{2,12}$/.test(prefix)) {
    throw ApiError.badRequest("Prefix tidak tersedia — pastikan kanal campaign valid atau isi prefix");
  }
  const created = await withTransaction((client) =>
    insertVoucherBatch(client, venue, campaignId, prefix, targetCount - currentCount, "ditambah")
  );
  return {
    result: { count: targetCount, added: created.length, removed: 0 },
    message: `${created.length} voucher ditambah`,
  };
}

async function loadCodeUsage(venue: PromoVenue, id: string) {
  const current = await queryOne<{ id: string; usage_count: number }>(
    `SELECT id, usage_count FROM promo.promo_codes
     WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
    [id, venue.branchId, venue.companyId]
  );
  if (!current) throw ApiError.notFound("Kode tidak ditemukan");
  return Number(current.usage_count);
}

/** Toggle aktif selalu boleh; ganti kode/batas pakai hanya untuk voucher yang belum terpakai. */
export async function updateCode(venue: PromoVenue, id: string, body: CodePatch): Promise<void> {
  if (body.is_active === undefined && body.code === undefined && body.usage_limit === undefined) {
    throw ApiError.badRequest("Tidak ada field yang diubah");
  }
  const usageCount = await loadCodeUsage(venue, id);
  if ((body.code !== undefined || body.usage_limit !== undefined) && usageCount > 0) {
    throw ApiError.conflict("Voucher sudah terpakai — hanya status aktif yang boleh diubah");
  }

  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (body.is_active !== undefined) add("is_active", body.is_active);
  if (body.code !== undefined) add("code", body.code.toUpperCase());
  if (body.usage_limit !== undefined) add("usage_limit", body.usage_limit);

  values.push(id, venue.branchId, venue.companyId);
  try {
    const rows = await query<{ id: string }>(
      `UPDATE promo.promo_codes SET ${sets.join(", ")}
       WHERE id = $${values.length - 2} AND branch_id = $${values.length - 1}
         AND company_id = $${values.length}
       RETURNING id`,
      values
    );
    if (rows.length === 0) throw ApiError.notFound("Kode tidak ditemukan");
  } catch (err) {
    if (isUniqueViolation(err)) throw ApiError.conflict(DUPLICATE_CODE);
    throw err;
  }
}

/** Hapus voucher yang belum pernah terpakai beserta hold/released orphan-nya. */
export async function deleteCode(venue: PromoVenue, id: string): Promise<void> {
  if ((await loadCodeUsage(venue, id)) > 0) {
    throw ApiError.conflict("Voucher sudah terpakai — tidak bisa dihapus");
  }
  await query(
    `DELETE FROM promo.promo_redemptions
     WHERE code_id = $1 AND status IN ('held', 'released')`,
    [id]
  );
  const rows = await query<{ id: string }>(
    `DELETE FROM promo.promo_codes
     WHERE id = $1 AND branch_id = $2 AND company_id = $3
       AND usage_count = 0
     RETURNING id`,
    [id, venue.branchId, venue.companyId]
  );
  if (rows.length === 0) throw ApiError.conflict("Gagal menghapus kode");
}
