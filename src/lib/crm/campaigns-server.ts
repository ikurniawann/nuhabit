// EPIC-033 — sisi server kampanye WA: preview segmen, build antrean
// penerima (klaim-dulu, exclude opt-out), dan konsumsi antrean oleh
// watcher. Keputusan owner 26 Jul: master switch default MATI — semua
// jalur kirim riil berhenti di config.enabled sebelum menyentuh gateway.

import type { Pool, PoolClient } from "pg";
import { getPool, query, queryOne, withTransaction } from "@/lib/db";
import { getSetting } from "@/lib/settings/app-settings";
import { generateVoucherCode } from "@/lib/promo/server";
import {
  buildSegmentFilter,
  normalizeChannels,
  normalizeSegment,
  parseCampaignConfig,
  renderInAppBody,
  selectDueCampaigns,
  shouldAbortCampaign,
  type CampaignConfig,
  type CampaignSegment,
} from "./campaigns";
import { buildSegmentWhere } from "./segments";
import { parseStoredSegment, type SegmentRow } from "./segments-server";

export const CAMPAIGN_CONFIG_KEY = "crm_campaign_config";

/**
 * Bandingkan dua kolom telepon dalam bentuk 62xxx: opt-out disimpan
 * ternormalisasi (628…) sedangkan pos_customers memakai 08…, jadi
 * perbandingan digit mentah tidak pernah cocok.
 */
export function samePhoneSql(a: string, b: string): string {
  const norm = (col: string) => `regexp_replace(regexp_replace(${col}, '\\D', '', 'g'), '^0', '62')`;
  return `${norm(a)} = ${norm(b)}`;
}

export interface CampaignVenueScope {
  companyId: string;
  branchId: string;
}

export async function getCampaignConfig(): Promise<CampaignConfig> {
  try {
    const raw = await getSetting(CAMPAIGN_CONFIG_KEY);
    return parseCampaignConfig(raw ? JSON.parse(String(raw)) : null);
  } catch {
    return parseCampaignConfig(null);
  }
}

/**
 * EPIC-050 T-5.1 — penerima kampanye boleh berasal dari segmen tersimpan.
 * Bila `segmentId` diisi dan segmennya bersumber member, filternya dipakai;
 * jika tidak, kampanye jatuh ke segmen inline lama (tetap kompatibel).
 */
export async function resolveCampaignFilter(
  segment: CampaignSegment,
  startIndex: number,
  segmentId: string | null | undefined
): Promise<{ where: string; params: unknown[]; savedName: string | null }> {
  if (!segmentId) {
    const f = buildSegmentFilter(segment, startIndex);
    return { ...f, savedName: null };
  }
  const row = await queryOne<SegmentRow>(
    `SELECT id, company_id, name, description, source, definition, is_active,
            last_count, last_counted_at, created_by, created_at, updated_at
     FROM crm.crm_segments WHERE id = $1 AND deleted_at IS NULL AND is_active`,
    [segmentId]
  );
  if (!row || row.source !== "member") {
    // Segmen hilang/nonaktif/bukan member → jangan diam-diam mengirim ke
    // seluruh basis pelanggan; pakai segmen inline seperti sebelumnya.
    const f = buildSegmentFilter(segment, startIndex);
    return { ...f, savedName: null };
  }
  const def = parseStoredSegment("member", row.definition);
  const f = buildSegmentWhere(def, { alias: "c", startIndex, companyId: null });
  // Penjaga nomor minimal tetap dipertahankan seperti jalur lama.
  return { where: `${f.where} AND length(trim(c.phone)) >= 8`, params: f.params, savedName: row.name };
}

export interface SegmentPreview {
  count: number;
  optedOut: number;
  sample: { name: string; phone: string; last_visit: string | null }[];
}

/**
 * Preview segmen TANPA kirim: jumlah member cocok (setelah dikurangi
 * opt-out) + 5 sampel. pos_customers global (tanpa kolom venue) — scope
 * venue berlaku di tabel kampanye/opt-out, konsisten pola CRM lain.
 */
export async function previewSegment(
  scope: CampaignVenueScope,
  segment: CampaignSegment,
  segmentId?: string | null
): Promise<SegmentPreview> {
  const filter = await resolveCampaignFilter(segment, 2, segmentId);
  const optoutJoin = `LEFT JOIN crm.crm_marketing_optouts o
       ON o.branch_id = $1
      AND ${samePhoneSql("o.phone", "c.phone")}`;
  const rows = await query<{ total: string; opted: string }>(
    `SELECT COUNT(*) FILTER (WHERE o.id IS NULL) AS total,
            COUNT(*) FILTER (WHERE o.id IS NOT NULL) AS opted
     FROM pos.pos_customers c
     ${optoutJoin}
     WHERE ${filter.where}`,
    [scope.branchId, ...filter.params]
  );
  const sample = await query<{
    name: string;
    phone: string;
    last_visit: string | null;
  }>(
    `SELECT c.name, c.phone, c.last_visit::text AS last_visit
     FROM pos.pos_customers c
     ${optoutJoin}
     WHERE ${filter.where} AND o.id IS NULL
     ORDER BY c.last_visit DESC NULLS LAST
     LIMIT 5`,
    [scope.branchId, ...filter.params]
  );
  return {
    count: Number(rows[0]?.total ?? 0),
    optedOut: Number(rows[0]?.opted ?? 0),
    sample,
  };
}

/**
 * Bangun antrean penerima utk satu kampanye (idempoten — ON CONFLICT per
 * (campaign, customer) DO NOTHING): snapshot nama+phone, exclude opt-out.
 * Mode voucher batch: tiap penerima langsung dibuatkan kode unik
 * sekali-pakai di engine promo (EPIC-032) dalam transaksi yang sama.
 */
export async function buildCampaignRecipients(
  client: PoolClient,
  campaign: {
    id: string;
    companyId: string;
    branchId: string;
    segment: CampaignSegment;
    segmentId?: string | null;
    promoCampaignId: string | null;
    promoMode: "public" | "batch" | null;
    voucherPrefix: string | null;
  }
): Promise<{ inserted: number }> {
  const filter = await resolveCampaignFilter(campaign.segment, 4, campaign.segmentId);
  const inserted = await client.query<{ id: string; customer_id: string }>(
    `INSERT INTO crm.crm_campaign_recipients
       (company_id, branch_id, campaign_id, customer_id, name, phone)
     SELECT $1, $2, $3, c.id, c.name,
            regexp_replace(c.phone, '\\D', '', 'g')
     FROM pos.pos_customers c
     LEFT JOIN crm.crm_marketing_optouts o
       ON o.branch_id = $2
      AND ${samePhoneSql("o.phone", "c.phone")}
     WHERE ${filter.where} AND o.id IS NULL
     ON CONFLICT (campaign_id, customer_id) DO NOTHING
     RETURNING id, customer_id`,
    [campaign.companyId, campaign.branchId, campaign.id, ...filter.params]
  );

  if (
    campaign.promoMode === "batch" &&
    campaign.promoCampaignId &&
    campaign.voucherPrefix &&
    inserted.rows.length > 0
  ) {
    for (const row of inserted.rows) {
      // Kode unik per penerima — tabrakan (23505) dicoba ulang beberapa kali
      let assigned = false;
      for (let attempt = 0; attempt < 5 && !assigned; attempt++) {
        const code = generateVoucherCode(campaign.voucherPrefix);
        const result = await client.query(
          `INSERT INTO promo.promo_codes
             (company_id, branch_id, campaign_id, code, usage_limit)
           VALUES ($1, $2, $3, $4, 1)
           ON CONFLICT (branch_id, code) DO NOTHING
           RETURNING id`,
          [campaign.companyId, campaign.branchId, campaign.promoCampaignId, code]
        );
        if ((result.rowCount ?? 0) > 0) {
          await client.query(
            `UPDATE crm.crm_campaign_recipients
             SET voucher_code = $2 WHERE id = $1`,
            [row.id, code]
          );
          assigned = true;
        }
      }
      if (!assigned) {
        throw new Error(
          "Gagal membuat kode voucher unik — coba prefix lain"
        );
      }
    }
  }
  return { inserted: inserted.rows.length };
}

/** Jumlah pesan terkirim HARI INI (WIB) per venue — plafon lintas kampanye. */
export async function countSentTodayWib(branchId: string): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM crm.crm_campaign_recipients
     WHERE branch_id = $1 AND status = 'sent'
       AND (sent_at AT TIME ZONE 'Asia/Jakarta')::date
           = (now() AT TIME ZONE 'Asia/Jakarta')::date`,
    [branchId]
  );
  return Number(rows[0]?.n ?? 0);
}

export interface ClaimedRecipient {
  id: string;
  campaign_id: string;
  name: string;
  phone: string;
  voucher_code: string | null;
  message_template: string;
}

/**
 * Klaim SATU penerima pending dari kampanye `sending` (FOR UPDATE SKIP
 * LOCKED — dua proses tak pernah memegang baris yang sama). Return null
 * bila antrean kosong.
 */
export async function claimNextRecipient(
  client: PoolClient,
  branchId: string
): Promise<ClaimedRecipient | null> {
  const rows = await client.query<ClaimedRecipient>(
    `SELECT r.id, r.campaign_id, r.name, r.phone, r.voucher_code,
            k.message_template
     FROM crm.crm_campaign_recipients r
     JOIN crm.crm_campaigns k ON k.id = r.campaign_id
     WHERE r.branch_id = $1 AND r.status = 'pending' AND k.status = 'sending'
       AND 'wa' = ANY(k.channels)
     ORDER BY r.created_at
     LIMIT 1
     FOR UPDATE OF r SKIP LOCKED`,
    [branchId]
  );
  return rows.rows[0] ?? null;
}

/** Tandai hasil kirim satu penerima (dipanggil dalam transaksi klaim). */
export async function markRecipient(
  client: PoolClient,
  recipientId: string,
  outcome: { status: "sent" } | { status: "failed"; reason: string }
): Promise<void> {
  await client.query(
    `UPDATE crm.crm_campaign_recipients
     SET status = $2, fail_reason = $3, attempted_at = now(),
         sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END
     WHERE id = $1`,
    [
      recipientId,
      outcome.status,
      outcome.status === "failed" ? outcome.reason : null,
    ]
  );
}

/** Kampanye `sending` tanpa pending tersisa → `done` (idempoten). */
export async function finishExhaustedCampaigns(): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE crm.crm_campaigns k
     SET status = 'done', updated_at = now()
     WHERE k.status = 'sending' AND k.recipients_built = true
       AND NOT EXISTS (
         SELECT 1 FROM crm.crm_campaign_recipients r
         WHERE r.campaign_id = k.id AND r.status = 'pending'
       )
     RETURNING id`,
    []
  );
  return rows.length;
}

/** Semua venue yang punya kampanye aktif — watcher berjalan per venue. */
export async function activeCampaignBranches(): Promise<string[]> {
  const rows = await query<{ branch_id: string }>(
    `SELECT DISTINCT branch_id FROM crm.crm_campaigns WHERE status = 'sending'`,
    []
  );
  return rows.map((r) => r.branch_id);
}

/** Plafon efektif venue = MIN(cap global, cap kampanye terkecil yang aktif)?
 * TIDAK — plafon global venue dipakai apa adanya; cap per kampanye membatasi
 * antrean kampanye itu sendiri via daily_cap (dihitung terpisah). MVP:
 * plafon global saja yang ditegakkan watcher; daily_cap kampanye = batas
 * tambahan per kampanye. */
export async function countCampaignSentTodayWib(
  campaignId: string
): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM crm.crm_campaign_recipients
     WHERE campaign_id = $1 AND status = 'sent'
       AND (sent_at AT TIME ZONE 'Asia/Jakarta')::date
           = (now() AT TIME ZONE 'Asia/Jakarta')::date`,
    [campaignId]
  );
  return Number(rows[0]?.n ?? 0);
}

export { withTransaction as campaignTransaction };

/* ── Start kampanye (manual & terjadwal) ─────────────────────────────── */

/** Kolom yang dibutuhkan untuk memulai kampanye. */
export const STARTABLE_CAMPAIGN_COLUMNS = `id, company_id, branch_id, name, status, segment, segment_id,
  promo_campaign_id, promo_mode, voucher_prefix, channels, message_template,
  inapp_title, image_url, link_url`;

export interface StartableCampaign {
  id: string;
  company_id: string;
  branch_id: string;
  name: string;
  status: string;
  segment: unknown;
  segment_id: string | null;
  promo_campaign_id: string | null;
  promo_mode: "public" | "batch" | null;
  voucher_prefix: string | null;
  channels: string[];
  message_template: string;
  inapp_title: string | null;
  image_url: string | null;
  link_url: string | null;
}

/**
 * Salin kampanye ke kotak masuk portal setiap penerima. Idempoten lewat
 * indeks unik (campaign_id, customer_id): memulai ulang tidak mengirim dobel.
 */
async function deliverInApp(client: PoolClient, campaign: StartableCampaign): Promise<number> {
  const { rows } = await client.query<{ customer_id: string; name: string; voucher_code: string | null }>(
    `SELECT customer_id, name, voucher_code FROM crm.crm_campaign_recipients WHERE campaign_id = $1`,
    [campaign.id]
  );
  if (rows.length === 0) return 0;
  const bodies = rows.map((r) =>
    renderInAppBody(campaign.message_template, { nama: r.name, kode: r.voucher_code })
  );
  const result = await client.query(
    `INSERT INTO crm.member_notifications
       (customer_id, type, title, body, image_url, link_url, campaign_id)
     SELECT t.customer_id, 'campaign', $3, t.body, $4, $5, $1
       FROM unnest($2::uuid[], $6::text[]) AS t(customer_id, body)
     ON CONFLICT (campaign_id, customer_id) WHERE campaign_id IS NOT NULL DO NOTHING`,
    [
      campaign.id,
      rows.map((r) => r.customer_id),
      campaign.inapp_title || campaign.name,
      campaign.image_url,
      campaign.link_url,
      bodies,
    ]
  );
  return result.rowCount ?? 0;
}

/**
 * Bangun antrean, kirim kanal in-app seketika, lalu serahkan WA ke watcher.
 * Kampanye tanpa kanal WA langsung selesai; antreannya ditandai skipped agar
 * watcher tidak pernah mengirim WA untuknya.
 */
export async function startCampaign(
  client: PoolClient,
  campaign: StartableCampaign
): Promise<{ inserted: number; inApp: number; status: "sending" | "done" }> {
  const { inserted } = await buildCampaignRecipients(client, {
    id: campaign.id,
    companyId: campaign.company_id,
    branchId: campaign.branch_id,
    segment: normalizeSegment(campaign.segment),
    segmentId: campaign.segment_id,
    promoCampaignId: campaign.promo_campaign_id,
    promoMode: campaign.promo_mode,
    voucherPrefix: campaign.voucher_prefix,
  });
  const channels = normalizeChannels(campaign.channels);
  const inApp = channels.includes("in_app") ? await deliverInApp(client, campaign) : 0;
  const waOn = channels.includes("wa");
  if (!waOn) {
    await client.query(
      `UPDATE crm.crm_campaign_recipients SET status = 'skipped', fail_reason = 'kanal-wa-mati'
        WHERE campaign_id = $1 AND status = 'pending'`,
      [campaign.id]
    );
  }
  const status = waOn ? "sending" : "done";
  await client.query(
    `UPDATE crm.crm_campaigns
        SET status = $2, recipients_built = true, failure_reason = NULL,
            started_at = COALESCE(started_at, now()), updated_at = now()
      WHERE id = $1`,
    [campaign.id, status]
  );
  return { inserted, inApp, status };
}

/** Tandai kampanye gagal (dengan alasan) bila masih berjalan/terjadwal. */
async function markCampaignFailed(
  db: Pool | PoolClient,
  campaignId: string,
  reason: string
): Promise<void> {
  await db.query(
    `UPDATE crm.crm_campaigns SET status = 'failed', failure_reason = $2, updated_at = now()
      WHERE id = $1 AND status IN ('scheduled', 'sending')`,
    [campaignId, reason]
  );
}

/**
 * Mulai kampanye terjadwal yang sudah jatuh tempo. Dijalankan tiap tick
 * watcher, terlepas dari master switch WA: kanal in-app tidak bergantung
 * pada gateway, dan antrean WA tetap menunggu switch.
 */
export async function startDueScheduledCampaigns(now = new Date()): Promise<number> {
  const scheduled = await query<{ id: string; status: string; scheduled_at: string }>(
    `SELECT id, status, scheduled_at FROM crm.crm_campaigns WHERE status = 'scheduled'`,
    []
  );
  let started = 0;
  for (const due of selectDueCampaigns(scheduled, now)) {
    try {
      const ok = await withTransaction(async (client) => {
        const { rows } = await client.query<StartableCampaign>(
          `SELECT ${STARTABLE_CAMPAIGN_COLUMNS} FROM crm.crm_campaigns
            WHERE id = $1 AND status = 'scheduled' FOR UPDATE SKIP LOCKED`,
          [due.id]
        );
        if (!rows[0]) return false;
        await startCampaign(client, rows[0]);
        return true;
      });
      if (ok) started += 1;
    } catch (err) {
      console.error("[crm-campaign] start terjadwal gagal:", err);
      await markCampaignFailed(getPool(), due.id, `Gagal memulai: ${(err as Error).message}`.slice(0, 300));
    }
  }
  return started;
}

/**
 * Setelah kirim WA gagal: hentikan kampanye bila percobaan terakhir gagal
 * semua (lihat shouldAbortCampaign). Return true bila kampanye dihentikan.
 */
export async function abortIfFailing(client: PoolClient, campaignId: string): Promise<boolean> {
  const { rows } = await client.query<{ status: "sent" | "failed" }>(
    `SELECT status FROM crm.crm_campaign_recipients
      WHERE campaign_id = $1 AND attempted_at IS NOT NULL
      ORDER BY attempted_at DESC LIMIT 20`,
    [campaignId]
  );
  if (!shouldAbortCampaign(rows.map((r) => r.status))) return false;
  await markCampaignFailed(
    client,
    campaignId,
    "Pengiriman WA gagal beruntun; periksa gateway lalu lanjutkan kampanye"
  );
  return true;
}
