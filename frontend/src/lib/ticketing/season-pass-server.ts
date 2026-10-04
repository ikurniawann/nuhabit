import "server-only";
// EPIC-028 — Season Pass di loket & gate: daftar pass terbit, opsi produk,
// penerbitan (bayar di tempat → langsung active), perpanjangan, dan
// validasi masuk (QR access_token / pass_code / UID gelang tertaut).

import type { PoolClient } from "pg";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { generateAccessToken, todayInJakarta } from "./booking";
import { addMonthsIso, generatePassCode } from "./season-pass";
import {
  isValidNfcUid,
  normalizeNfcUid,
  requireNfcUid,
  type TicketingContext,
} from "./server";
import { conflictOnDuplicate } from "./sql";

/**
 * Harga pass = varian aktif pertama (varian "Umum"), fallback base_price.
 * Dipakai di FROM ... tp sebagai LATERAL `v`.
 */
export const PASS_PRICE_LATERAL = `LEFT JOIN LATERAL (
     SELECT price_regular FROM ticketing.ticket_product_variants
     WHERE ticket_product_id = tp.id AND is_active = true
     ORDER BY sort_order LIMIT 1
   ) v ON true`;

interface PassListRow {
  id: string;
  pass_code: string;
  holder_name: string;
  holder_phone: string | null;
  product_name: string;
  status: string;
  entry_policy: string;
  valid_from: string | null;
  valid_until: string | null;
  visit_quota_total: number | null;
  visit_quota_used: number;
  band_uid: string | null;
  unit_price: string;
  created_at: string;
}

/** Daftar pass terbit (venue scoped). */
export async function listSeasonPasses(ctx: TicketingContext, q: string) {
  const params: unknown[] = [ctx.branchId, ctx.companyId];
  let where = "sp.branch_id = $1 AND sp.company_id = $2";
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (sp.pass_code ILIKE $${params.length} OR sp.holder_name ILIKE $${params.length} OR sp.holder_phone ILIKE $${params.length})`;
  }
  const rows = await query<PassListRow>(
    `SELECT sp.id, sp.pass_code, sp.holder_name, sp.holder_phone,
            tp.name AS product_name, sp.status, sp.entry_policy,
            sp.valid_from, sp.valid_until, sp.visit_quota_total,
            sp.visit_quota_used, sp.band_uid, sp.unit_price, sp.created_at
     FROM ticketing.ticket_season_passes sp
     JOIN ticketing.ticket_products tp ON tp.id = sp.ticket_product_id
     WHERE ${where}
     ORDER BY sp.created_at DESC
     LIMIT 200`,
    params
  );
  return rows.map((r) => ({ ...r, unit_price: Number(r.unit_price) }));
}

/**
 * Opsi produk Season Pass untuk penerbitan di loket: hanya produk Active
 * berjenis season_pass yang punya config.
 */
export async function listPassOptions(ctx: TicketingContext) {
  const rows = await query<{
    ticket_product_id: string;
    name: string;
    validity_months: number;
    entry_policy: string;
    visit_quota: number | null;
    unit_price: string | null;
  }>(
    `SELECT tp.id AS ticket_product_id, tp.name,
            pc.validity_months, pc.entry_policy, pc.visit_quota,
            COALESCE(v.price_regular, tp.base_price) AS unit_price
     FROM ticketing.ticket_products tp
     JOIN ticketing.ticket_pass_configs pc ON pc.ticket_product_id = tp.id
     ${PASS_PRICE_LATERAL}
     WHERE tp.branch_id = $1 AND tp.company_id = $2
       AND tp.product_kind = 'season_pass' AND tp.status = 'active'
     ORDER BY tp.name`,
    [ctx.branchId, ctx.companyId]
  );
  return rows.map((r) => ({
    ticket_product_id: r.ticket_product_id,
    name: r.name,
    validity_months: r.validity_months,
    entry_policy: r.entry_policy,
    visit_quota: r.visit_quota,
    unit_price: Number(r.unit_price ?? 0),
  }));
}

export const issuePassSchema = z.object({
  ticket_product_id: z.string().uuid(),
  holder_name: z.string().trim().min(2).max(120),
  holder_phone: z.string().trim().max(25).optional().nullable(),
  band_uid: z.string().trim().max(64).optional().nullable(),
});

/** Terbitkan pass di loket (dibayar di tempat → langsung active). */
export async function issueSeasonPass(
  ctx: TicketingContext,
  body: z.infer<typeof issuePassSchema>
) {
  // Produk pass + config (harus Active season_pass milik venue ini)
  const config = await queryOne<{
    validity_months: number;
    entry_policy: string;
    visit_quota: number | null;
    unit_price: string | null;
  }>(
    `SELECT pc.validity_months, pc.entry_policy, pc.visit_quota,
            COALESCE(v.price_regular, tp.base_price) AS unit_price
     FROM ticketing.ticket_products tp
     JOIN ticketing.ticket_pass_configs pc ON pc.ticket_product_id = tp.id
     ${PASS_PRICE_LATERAL}
     WHERE tp.id = $1 AND tp.branch_id = $2 AND tp.company_id = $3
       AND tp.product_kind = 'season_pass' AND tp.status = 'active'`,
    [body.ticket_product_id, ctx.branchId, ctx.companyId]
  );
  if (!config) {
    throw ApiError.badRequest("Produk Season Pass tidak ditemukan atau belum aktif");
  }

  // Gelang NFC opsional: bila diisi, harus sudah terdaftar di venue
  let bandId: string | null = null;
  let bandUid: string | null = null;
  if (body.band_uid) {
    const uid = requireNfcUid(body.band_uid);
    const band = await queryOne<{ id: string }>(
      `SELECT id FROM ticketing.ticket_bands
       WHERE nfc_uid = $1 AND branch_id = $2 AND company_id = $3`,
      [uid, ctx.branchId, ctx.companyId]
    );
    if (!band) {
      throw ApiError.badRequest("Gelang belum terdaftar — daftarkan dulu di Pengaturan");
    }
    bandId = band.id;
    bandUid = uid;
  }

  const today = todayInJakarta();
  const validUntil = addMonthsIso(today, config.validity_months);
  const accessToken = generateAccessToken();
  const quotaTotal = config.entry_policy === "limited_visits" ? config.visit_quota : null;
  const unitPrice = Number(config.unit_price ?? 0);

  const pass = await conflictOnDuplicate(
    withTransaction(async (client) => {
      const passCode = await generatePassCode(client, ctx.branchId, today);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO ticketing.ticket_season_passes
           (company_id, branch_id, ticket_product_id, pass_code, access_token,
            holder_name, holder_phone, valid_from, valid_until, status,
            entry_policy, visit_quota_total, visit_quota_used, band_id, band_uid,
            source, unit_price, paid_at, activated_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11,0,$12,$13,
                 'loket',$14, now(), now(), $15)
         RETURNING id`,
        [
          ctx.companyId,
          ctx.branchId,
          body.ticket_product_id,
          passCode,
          accessToken,
          body.holder_name,
          body.holder_phone || null,
          today,
          validUntil,
          config.entry_policy,
          quotaTotal,
          bandId,
          bandUid,
          unitPrice,
          ctx.user.id,
        ]
      );
      return { id: inserted.rows[0].id, passCode };
    }),
    "Tabrakan kode pass — coba terbitkan sekali lagi"
  );

  return {
    id: pass.id,
    pass_code: pass.passCode,
    access_token: accessToken,
    holder_name: body.holder_name,
    valid_from: today,
    valid_until: validUntil,
    entry_policy: config.entry_policy,
    visit_quota_total: quotaTotal,
    unit_price: unitPrice,
    band_uid: bandUid,
  };
}

/**
 * EPIC-028 Fase D — perpanjang pass di loket. valid_until diperpanjang
 * validity_months dari MAX(hari ini, valid_until saat ini) — pass yang
 * belum habis menambah sisa, yang sudah habis mulai dari hari ini.
 * Punch-card → jatah kunjungan di-reset penuh.
 */
export async function renewSeasonPass(ctx: TicketingContext, id: string) {
  const pass = await queryOne<{
    status: string;
    entry_policy: string;
    valid_until: string | null;
    validity_months: number;
    visit_quota: number | null;
  }>(
    `SELECT sp.status, sp.entry_policy, sp.valid_until::text AS valid_until,
            pc.validity_months, pc.visit_quota
     FROM ticketing.ticket_season_passes sp
     JOIN ticketing.ticket_pass_configs pc ON pc.ticket_product_id = sp.ticket_product_id
     WHERE sp.id = $1 AND sp.branch_id = $2 AND sp.company_id = $3`,
    [id, ctx.branchId, ctx.companyId]
  );
  if (!pass) throw ApiError.notFound("Pass tidak ditemukan");
  if (pass.status === "cancelled") {
    throw ApiError.badRequest("Pass dibatalkan — tidak bisa diperpanjang");
  }
  if (pass.status === "pending") {
    throw ApiError.badRequest("Pass belum aktif (menunggu pembayaran)");
  }

  const today = todayInJakarta();
  const base = pass.valid_until && pass.valid_until > today ? pass.valid_until : today;
  const validUntil = addMonthsIso(base, pass.validity_months);
  const resetQuota = pass.entry_policy === "limited_visits";

  await query(
    `UPDATE ticketing.ticket_season_passes
     SET valid_until = $2,
         valid_from = COALESCE(valid_from, $3),
         status = 'active',
         activated_at = COALESCE(activated_at, now()),
         visit_quota_total = CASE WHEN $4 THEN $5 ELSE visit_quota_total END,
         visit_quota_used = CASE WHEN $4 THEN 0 ELSE visit_quota_used END,
         updated_at = now()
     WHERE id = $1`,
    [id, validUntil, today, resetQuota, pass.visit_quota]
  );
  return { id, valid_until: validUntil, quota_reset: resetQuota };
}

// ── Validasi masuk di gate (EPIC-028 Fase C) ──────────────────────────
// Validasi berlapis: status → masa berlaku → blackout → kebijakan entry
// (1×/hari, tak terbatas, jatah kunjungan). Semua dicatat di
// ticket_pass_entries.

export type PassTapResult =
  | "granted"
  | "denied_expired"
  | "denied_duplicate"
  | "denied_quota"
  | "denied_inactive"
  | "denied_blackout"
  | "bukan-pass";

interface PassRow {
  id: string;
  pass_code: string;
  holder_name: string;
  status: string;
  entry_policy: string;
  valid_from: string | null;
  valid_until: string | null;
  visit_quota_total: number | null;
  visit_quota_used: number;
  band_uid: string | null;
  ticket_product_id: string;
  product_name: string;
}

const HEX64 = /^[0-9a-f]{64}$/i;

/** Kolom pencarian pass dari kode mentah: QR token, pass_code, atau UID gelang. */
function passLookupKey(raw: string): { column: string; key: string } | null {
  if (HEX64.test(raw)) return { column: "sp.access_token", key: raw.toLowerCase() };
  if (/^SP-/i.test(raw)) return { column: "sp.pass_code", key: raw.toUpperCase() };
  const uid = normalizeNfcUid(raw);
  return isValidNfcUid(uid) ? { column: "sp.band_uid", key: uid } : null;
}

async function lockPass(
  client: PoolClient,
  ctx: TicketingContext,
  raw: string
): Promise<PassRow | null> {
  const lookup = passLookupKey(raw);
  if (!lookup) return null;
  const res = await client.query<PassRow>(
    `SELECT sp.id, sp.pass_code, sp.holder_name, sp.status, sp.entry_policy,
            sp.valid_from::text AS valid_from, sp.valid_until::text AS valid_until,
            sp.visit_quota_total, sp.visit_quota_used, sp.band_uid,
            sp.ticket_product_id, tp.name AS product_name
     FROM ticketing.ticket_season_passes sp
     JOIN ticketing.ticket_products tp ON tp.id = sp.ticket_product_id
     WHERE sp.branch_id = $1 AND sp.company_id = $2 AND ${lookup.column} = $3
     LIMIT 1 FOR UPDATE OF sp`,
    [ctx.branchId, ctx.companyId, lookup.key]
  );
  return res.rows[0] ?? null;
}

export async function processPassTap(ctx: TicketingContext, code: string, gateLabel: string) {
  return withTransaction(async (client) => {
    const pass = await lockPass(client, ctx, code);
    if (!pass) {
      return {
        ok: false,
        result: "bukan-pass" as PassTapResult,
        reason: "Kode tidak dikenal sebagai Season Pass",
      };
    }

    const today = todayInJakarta();
    const log = (result: PassTapResult) =>
      client.query(
        `INSERT INTO ticketing.ticket_pass_entries
           (company_id, branch_id, season_pass_id, entry_date, entry_policy,
            gate_label, band_uid, result, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          ctx.companyId,
          ctx.branchId,
          pass.id,
          today,
          pass.entry_policy,
          gateLabel,
          pass.band_uid,
          result,
          ctx.user.id,
        ]
      );
    const holder = {
      holder_name: pass.holder_name,
      pass_code: pass.pass_code,
      ticket_type_name: pass.product_name,
    };
    const deny = async (result: PassTapResult, reason: string) => {
      await log(result);
      return { ok: false, result, reason, ...holder };
    };
    const grant = async (extra: { remaining_quota?: number } = {}) => {
      await log("granted");
      return {
        ok: true,
        result: "granted" as PassTapResult,
        ...holder,
        valid_until: pass.valid_until,
        entry_policy: pass.entry_policy,
        ...extra,
      };
    };

    if (pass.status !== "active") {
      return deny(
        "denied_inactive",
        pass.status === "pending"
          ? "Pass belum aktif (menunggu pembayaran)"
          : `Pass berstatus ${pass.status}`
      );
    }
    if (
      (pass.valid_from && today < pass.valid_from) ||
      (pass.valid_until && today > pass.valid_until)
    ) {
      return deny("denied_expired", "Pass di luar masa berlaku");
    }

    const blackout = await client.query(
      `SELECT 1 FROM ticketing.ticket_product_dates
       WHERE ticket_product_id = $1 AND date_kind = 'blackout'
         AND is_active = true AND $2::date BETWEEN start_date AND end_date
       LIMIT 1`,
      [pass.ticket_product_id, today]
    );
    if (blackout.rows.length > 0) {
      return deny("denied_blackout", "Tanggal ini blackout untuk pass ini");
    }

    if (pass.entry_policy === "limited_visits") {
      const total = pass.visit_quota_total ?? 0;
      if (pass.visit_quota_used >= total) {
        return deny("denied_quota", "Jatah kunjungan sudah habis");
      }
      await client.query(
        `UPDATE ticketing.ticket_season_passes
         SET visit_quota_used = visit_quota_used + 1, updated_at = now()
         WHERE id = $1`,
        [pass.id]
      );
      return grant({ remaining_quota: total - pass.visit_quota_used - 1 });
    }

    // once_per_day: cek entri granted hari ini (unique index = backstop race)
    if (pass.entry_policy === "once_per_day") {
      const dup = await client.query(
        `SELECT 1 FROM ticketing.ticket_pass_entries
         WHERE season_pass_id = $1 AND entry_date = $2 AND result = 'granted'
         LIMIT 1`,
        [pass.id, today]
      );
      if (dup.rows.length > 0) {
        return deny("denied_duplicate", "Pass sudah dipakai masuk hari ini");
      }
    }

    // unlimited & once_per_day (lolos cek) → granted
    return grant();
  });
}
