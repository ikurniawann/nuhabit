import "server-only";
/**
 * EPIC-033 — pengelolaan kampanye WA dari dashboard: daftar, buat, aksi
 * (start/schedule/pause/resume/cancel), edit draft, dan laporan funnel.
 * PENGIRIMAN WA tetap di tangan watcher + master switch (campaigns-server).
 */
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { createPgClient } from "@/lib/pg/create-client";
import {
  isSafeLink,
  normalizeChannels,
  normalizeSegment,
  SCHEDULE_ISSUE_MESSAGES,
  validateSchedule,
  validateTemplate,
} from "./campaigns";
import {
  startCampaign,
  STARTABLE_CAMPAIGN_COLUMNS,
  type CampaignVenueScope,
  type StartableCampaign,
} from "./campaigns-server";
import { getCrmDefaultVenue } from "./server";

/** Venue default kampanye (single-venue). */
export function campaignVenue() {
  return getCrmDefaultVenue(createPgClient());
}

export const VENUE_NOT_CONFIGURED = "Venue belum dikonfigurasi";

/** Venue lengkap (company + branch) untuk membuat/menghitung kampanye; 400 bila belum diset. */
export async function requireCampaignVenue(): Promise<CampaignVenueScope> {
  const { companyId, branchId } = await campaignVenue();
  if (!companyId || !branchId) throw ApiError.badRequest(VENUE_NOT_CONFIGURED);
  return { companyId, branchId };
}

interface CampaignListRow {
  id: string;
  name: string;
  message_template: string;
  segment: unknown;
  segment_id: string | null;
  segment_name: string | null;
  promo_campaign_id: string | null;
  promo_mode: "public" | "batch" | null;
  voucher_prefix: string | null;
  status: string;
  daily_cap: number | null;
  recipients_built: boolean;
  created_at: string;
  channels: string[];
  scheduled_at: string | null;
  started_at: string | null;
  failure_reason: string | null;
  inapp_title: string | null;
  image_url: string | null;
  link_url: string | null;
  pending_count: string;
  sent_count: string;
  failed_count: string;
  inapp_count: string;
}

export function listCampaigns(branchId: string) {
  return query<CampaignListRow>(
    `SELECT k.id, k.name, k.message_template, k.segment, k.segment_id, sg.name AS segment_name,
            k.promo_campaign_id, k.promo_mode, k.voucher_prefix, k.status,
            k.daily_cap, k.recipients_built, k.created_at, k.channels, k.scheduled_at,
            k.started_at, k.failure_reason, k.inapp_title, k.image_url, k.link_url,
            (SELECT COUNT(*) FROM crm.crm_campaign_recipients r
              WHERE r.campaign_id = k.id AND r.status = 'pending') AS pending_count,
            (SELECT COUNT(*) FROM crm.crm_campaign_recipients r
              WHERE r.campaign_id = k.id AND r.status = 'sent') AS sent_count,
            (SELECT COUNT(*) FROM crm.crm_campaign_recipients r
              WHERE r.campaign_id = k.id AND r.status = 'failed') AS failed_count,
            (SELECT COUNT(*) FROM crm.member_notifications n
              WHERE n.campaign_id = k.id) AS inapp_count
     FROM crm.crm_campaigns k
     LEFT JOIN crm.crm_segments sg ON sg.id = k.segment_id
     WHERE k.branch_id = $1
     ORDER BY k.created_at DESC`,
    [branchId]
  );
}

const linkUrl = z.string().trim().max(500).refine(isSafeLink, "Tautan tidak valid").nullable().optional();

export const createCampaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  message_template: z.string().trim().min(10).max(2000),
  segment: z.unknown(),
  segment_id: z.string().uuid().nullable().optional(),
  promo_campaign_id: z.string().uuid().nullable().optional(),
  promo_mode: z.enum(["public", "batch"]).nullable().optional(),
  voucher_prefix: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{2,12}$/)
    .nullable()
    .optional(),
  daily_cap: z.number().int().positive().max(2000).nullable().optional(),
  channels: z.array(z.enum(["wa", "in_app"])).min(1).optional(),
  inapp_title: z.string().trim().max(120).nullable().optional(),
  image_url: z.string().trim().url().max(500).nullable().optional(),
  link_url: linkUrl,
  /** Diisi = "Kirim nanti": kampanye langsung berstatus scheduled. */
  scheduled_at: z.string().datetime({ offset: true }).nullable().optional(),
});

function parseSchedule(raw: string): Date {
  const schedule = validateSchedule(raw, new Date());
  if (!schedule.ok) throw ApiError.badRequest(SCHEDULE_ISSUE_MESSAGES[schedule.reason]);
  return schedule.at;
}

export async function createCampaign(body: z.infer<typeof createCampaignSchema>, userId: string) {
  const promoMode = body.promo_campaign_id ? (body.promo_mode ?? "public") : null;
  if (promoMode === "batch" && !body.voucher_prefix) {
    throw ApiError.badRequest("Mode voucher batch wajib mengisi prefix kode");
  }
  const templateCheck = validateTemplate(body.message_template, promoMode);
  if (!templateCheck.ok) {
    throw ApiError.badRequest(
      templateCheck.reason === "template-tanpa-kode"
        ? "Mode voucher batch wajib menyebut {kode} di template"
        : "Template memuat {kode} tapi kampanye tidak melampirkan promo"
    );
  }
  const scheduledAt = body.scheduled_at ? parseSchedule(body.scheduled_at) : null;

  const venue = await requireCampaignVenue();
  const rows = await query<{ id: string }>(
    `INSERT INTO crm.crm_campaigns
       (company_id, branch_id, name, message_template, segment, segment_id,
        promo_campaign_id, promo_mode, voucher_prefix, daily_cap, created_by,
        channels, inapp_title, image_url, link_url, scheduled_at, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING id`,
    [
      venue.companyId,
      venue.branchId,
      body.name,
      body.message_template,
      JSON.stringify(normalizeSegment(body.segment)),
      body.segment_id ?? null,
      body.promo_campaign_id ?? null,
      promoMode,
      promoMode === "batch" ? body.voucher_prefix!.toUpperCase() : null,
      body.daily_cap ?? null,
      userId,
      normalizeChannels(body.channels),
      body.inapp_title || null,
      body.image_url || null,
      body.link_url || null,
      scheduledAt,
      scheduledAt ? "scheduled" : "draft",
    ]
  );
  return { id: rows[0].id, scheduled: scheduledAt !== null };
}

export const patchCampaignSchema = z.object({
  action: z.enum(["start", "schedule", "pause", "resume", "cancel"]).optional(),
  scheduled_at: z.string().datetime({ offset: true }).optional(),
  name: z.string().trim().min(2).max(120).optional(),
  message_template: z.string().trim().min(10).max(2000).optional(),
  segment: z.unknown().optional(),
  segment_id: z.string().uuid().nullable().optional(),
  daily_cap: z.number().int().positive().max(2000).nullable().optional(),
  channels: z.array(z.enum(["wa", "in_app"])).min(1).optional(),
  inapp_title: z.string().trim().max(120).nullable().optional(),
  image_url: z.string().trim().url().max(500).nullable().optional(),
  link_url: linkUrl,
});
type CampaignPatch = z.infer<typeof patchCampaignSchema>;
type CampaignActionResult = { data: Record<string, unknown>; message: string };

/** Kampanye di venue default; 404 bila tidak ada. */
export async function requireCampaign(id: string): Promise<StartableCampaign> {
  const venue = await campaignVenue();
  const campaign = await queryOne<StartableCampaign>(
    `SELECT ${STARTABLE_CAMPAIGN_COLUMNS}
     FROM crm.crm_campaigns WHERE id = $1 AND branch_id = $2`,
    [id, venue.branchId]
  );
  if (!campaign) throw ApiError.notFound("Kampanye tidak ditemukan");
  return campaign;
}

/** Build antrean → sending. Baris dikunci: watcher bisa memulai kampanye terjadwal yang sama. */
async function start(campaign: StartableCampaign): Promise<CampaignActionResult> {
  const id = campaign.id;
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query<{ status: string }>(
      `SELECT status FROM crm.crm_campaigns WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!["draft", "paused", "scheduled"].includes(rows[0]?.status ?? "")) return null;
    return startCampaign(client, campaign);
  });
  if (!result) throw ApiError.conflict("Status kampanye sudah berubah — muat ulang halaman");
  const parts = [`${result.inserted} penerima baru`];
  if (result.inApp > 0) parts.push(`${result.inApp} notifikasi in-app terkirim`);
  return {
    data: { id, ...result },
    message:
      result.status === "sending"
        ? `Kampanye dimulai: ${parts.join(", ")}. WA mengikuti master switch & jam kirim.`
        : `Kampanye selesai: ${parts.join(", ")}.`,
  };
}

async function schedule(campaign: StartableCampaign, rawAt: string | undefined): Promise<CampaignActionResult> {
  if (!["draft", "scheduled"].includes(campaign.status)) {
    throw ApiError.conflict("Hanya kampanye draft yang bisa dijadwalkan");
  }
  const at = parseSchedule(rawAt ?? "");
  await query(
    `UPDATE crm.crm_campaigns SET status = 'scheduled', scheduled_at = $2, updated_at = now()
     WHERE id = $1 AND status IN ('draft', 'scheduled')`,
    [campaign.id, at]
  );
  return { data: { id: campaign.id, scheduled_at: at.toISOString() }, message: "Kampanye dijadwalkan" };
}

/** Transisi status sederhana; WHERE menjaga status asal yang sah. */
const STATUS_ACTIONS = {
  pause: {
    sql: `UPDATE crm.crm_campaigns SET status = 'paused', updated_at = now()
          WHERE id = $1 AND status = 'sending'`,
    message: "Kampanye dijeda",
  },
  cancel: {
    sql: `UPDATE crm.crm_campaigns SET status = 'cancelled', updated_at = now()
          WHERE id = $1 AND status IN ('draft', 'scheduled', 'sending', 'paused', 'failed')`,
    message: "Kampanye dibatalkan",
  },
  // Kampanye failed dilanjutkan setelah gateway dibereskan; antrean tetap.
  resume: {
    sql: `UPDATE crm.crm_campaigns SET status = 'sending', failure_reason = NULL, updated_at = now()
          WHERE id = $1 AND status IN ('paused', 'failed') AND recipients_built`,
    message: "Kampanye dilanjutkan",
  },
} as const;

/** Edit field — hanya draft (antrean belum dibangun dari segmen lama). */
async function editDraft(campaign: StartableCampaign, body: CampaignPatch): Promise<CampaignActionResult> {
  if (campaign.status !== "draft") {
    throw ApiError.conflict("Hanya kampanye draft yang bisa diedit — jeda/batalkan dulu");
  }
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (body.name !== undefined) add("name", body.name);
  if (body.message_template !== undefined) add("message_template", body.message_template);
  if (body.segment_id !== undefined) add("segment_id", body.segment_id ?? null);
  if (body.segment !== undefined) add("segment", JSON.stringify(normalizeSegment(body.segment)));
  if (body.daily_cap !== undefined) add("daily_cap", body.daily_cap);
  if (body.channels !== undefined) add("channels", normalizeChannels(body.channels));
  if (body.inapp_title !== undefined) add("inapp_title", body.inapp_title || null);
  if (body.image_url !== undefined) add("image_url", body.image_url || null);
  if (body.link_url !== undefined) add("link_url", body.link_url || null);
  values.push(campaign.id);
  await query(`UPDATE crm.crm_campaigns SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
  return { data: { id: campaign.id }, message: "Kampanye diperbarui" };
}

export async function applyCampaignPatch(campaign: StartableCampaign, body: CampaignPatch): Promise<CampaignActionResult> {
  if (body.action === "start") return start(campaign);
  if (body.action === "schedule") return schedule(campaign, body.scheduled_at);
  if (body.action) {
    const action = STATUS_ACTIONS[body.action];
    await query(action.sql, [campaign.id]);
    return { data: { id: campaign.id }, message: action.message };
  }
  return editDraft(campaign, body);
}

/**
 * EPIC-033 Fase C — funnel kampanye: antrean → terkirim → voucher dipakai
 * (konversi dari promo_redemptions EPIC-032, tanpa tracking baru). Mode batch:
 * cocokkan kode voucher penerima; mode public: cocokkan nomor WA penerima
 * dengan phone redemption campaign promo terlampir.
 */
export async function loadCampaignReport(id: string) {
  const venue = await campaignVenue();
  const campaign = await queryOne<{
    id: string;
    name: string;
    status: string;
    promo_campaign_id: string | null;
    promo_mode: "public" | "batch" | null;
    channels: string[];
    scheduled_at: string | null;
    started_at: string | null;
    failure_reason: string | null;
  }>(
    `SELECT id, name, status, promo_campaign_id, promo_mode, channels,
            scheduled_at, started_at, failure_reason
     FROM crm.crm_campaigns WHERE id = $1 AND branch_id = $2`,
    [id, venue.branchId]
  );
  if (!campaign) throw ApiError.notFound("Kampanye tidak ditemukan");

  const counts = await queryOne<{ total: string; pending: string; sent: string; failed: string; skipped: string }>(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'pending') AS pending,
            COUNT(*) FILTER (WHERE status = 'sent') AS sent,
            COUNT(*) FILTER (WHERE status = 'failed') AS failed,
            COUNT(*) FILTER (WHERE status = 'skipped') AS skipped
     FROM crm.crm_campaign_recipients WHERE campaign_id = $1`,
    [id]
  );

  // Kanal in-app: terkirim = baris notifikasi; buka/klik dari jejak portal.
  const inApp = await queryOne<{ sent: string; opened: string; clicked: string }>(
    `SELECT COUNT(*) AS sent,
            COUNT(*) FILTER (WHERE opened_at IS NOT NULL OR clicked_at IS NOT NULL) AS opened,
            COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked
     FROM crm.member_notifications WHERE campaign_id = $1`,
    [id]
  );

  let conversion: { n: string; nilai: string } | null = null;
  if (campaign.promo_campaign_id) {
    conversion =
      campaign.promo_mode === "batch"
        ? await queryOne<{ n: string; nilai: string }>(
            `SELECT COUNT(DISTINCT r.code_id) AS n,
                    COALESCE(SUM(r.discount_amount), 0) AS nilai
             FROM promo.promo_redemptions r
             JOIN promo.promo_codes k ON k.id = r.code_id
             WHERE r.status <> 'released'
               AND k.code IN (
                 SELECT voucher_code FROM crm.crm_campaign_recipients
                 WHERE campaign_id = $1 AND voucher_code IS NOT NULL
               )`,
            [id]
          )
        : await queryOne<{ n: string; nilai: string }>(
            `SELECT COUNT(*) AS n, COALESCE(SUM(r.discount_amount), 0) AS nilai
             FROM promo.promo_redemptions r
             WHERE r.campaign_id = $2 AND r.status <> 'released'
               AND r.phone IN (
                 SELECT phone FROM crm.crm_campaign_recipients
                 WHERE campaign_id = $1 AND status = 'sent'
               )`,
            [id, campaign.promo_campaign_id]
          );
  }

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      channels: campaign.channels,
      scheduled_at: campaign.scheduled_at,
      started_at: campaign.started_at,
      failure_reason: campaign.failure_reason,
    },
    funnel: {
      total: Number(counts?.total ?? 0),
      pending: Number(counts?.pending ?? 0),
      sent: Number(counts?.sent ?? 0),
      failed: Number(counts?.failed ?? 0),
      skipped: Number(counts?.skipped ?? 0),
      redeemed: Number(conversion?.n ?? 0),
      redeemed_value: Number(conversion?.nilai ?? 0),
    },
    in_app: {
      sent: Number(inApp?.sent ?? 0),
      opened: Number(inApp?.opened ?? 0),
      clicked: Number(inApp?.clicked ?? 0),
    },
  };
}
