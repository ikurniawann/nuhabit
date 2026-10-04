import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import type { UserScope } from "@/lib/api/scope";
import { loadExistingCustom } from "@/lib/crm/custom-fields-server";
import { emitCrmEvent } from "@/lib/crm/events";
import { query, queryOne, withTransaction } from "@/lib/db";
import { formatDateLong } from "@/lib/format";
import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import type { AccessibleDeal } from "./access";
import { planStageMove, type DealUpdateFields, type createDealSchema, type updateDealSchema } from "./deals";
import { categoryFromStage } from "./forecast";
import {
  DEAL_EVENT_TYPES,
  assertOwnerAssignable,
  isValidCalendarDate,
  renderWaTemplate,
  requireValidPhone,
  resolveCustomValues,
  validateAssignableOwner,
  type SalesFunnelUser,
} from "./server";
import { createUpdateSet, createWhere, isUuid } from "./sql";

// Deal tertutup hanya tampil 90 hari terakhir agar kanban tidak tumbuh tanpa
// batas; riwayat lengkap = wilayah laporan Fase E.
const CLOSED_WINDOW_DAYS = 90;
// Pagar terakhir bila deal terbuka menumpuk bertahun-tahun.
const MAX_KANBAN_DEALS = 500;

const DEAL_COLUMNS = `
  d.id, d.company_id, d.branch_id, d.lead_id, d.title, d.event_type,
  d.event_date, d.is_event_date_fixed, d.pax_estimate, d.stage_id,
  d.value_estimate, d.value_final, d.owner_user_id, d.lost_reason_id,
  d.entered_stage_at, d.closed_at, d.created_at, d.updated_at,
  d.pipeline_id, d.forecast_category, d.custom, s.probability, s.name AS stage_name,
  l.org_name, l.org_type, l.pic_name, l.pic_phone, l.customer_id,
  s.code AS stage_code, s.is_won, s.is_lost, s.stuck_threshold_days,
  u.full_name AS owner_name, lr.name AS lost_reason_name`;

export async function listDeals(user: SalesFunnelUser, scope: UserScope | null, searchParams: URLSearchParams) {
  const q = searchParams.get("q")?.trim() ?? "";
  const eventType = searchParams.get("event_type") ?? "";
  const owner = searchParams.get("owner_user_id");
  const pipelineId = searchParams.get("pipeline_id");

  const where = createWhere([
    "d.deleted_at IS NULL",
    `(d.closed_at IS NULL OR d.closed_at >= now() - interval '${CLOSED_WINDOW_DAYS} days')`,
  ]);
  if (scope?.companyId) where.add("d.company_id = ?", scope.companyId);
  if (scope?.businessScope === "branch" && scope.branchId) where.add("d.branch_id = ?", scope.branchId);
  // Role sales hanya melihat deal miliknya ATAU tanpa owner (pola leads)
  if (user.role === "sales") where.add("(d.owner_user_id = ? OR d.owner_user_id IS NULL)", user.id);
  if ((DEAL_EVENT_TYPES as readonly string[]).includes(eventType)) where.add("d.event_type = ?", eventType);
  if (isUuid(owner)) where.add("d.owner_user_id = ?", owner);
  if (isUuid(pipelineId)) where.add("d.pipeline_id = ?", pipelineId);
  if (q) {
    const like = where.param(`%${q}%`);
    where.push(`(d.title ILIKE ${like} OR l.org_name ILIKE ${like} OR l.pic_name ILIKE ${like})`);
  }
  return query(
    `SELECT ${DEAL_COLUMNS}
     FROM crm.crm_sales_deals d
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     JOIN crm.crm_sales_stages s ON s.id = d.stage_id
     LEFT JOIN configuration.users u ON u.id = d.owner_user_id
     LEFT JOIN crm.crm_sales_lost_reasons lr ON lr.id = d.lost_reason_id
     WHERE ${where.sql()}
     ORDER BY d.entered_stage_at DESC
     LIMIT ${MAX_KANBAN_DEALS}`,
    where.params
  );
}

type LeadForDeal = {
  id: string;
  company_id: string;
  branch_id: string;
  owner_user_id: string | null;
  status: string;
  org_name: string;
};

/** Deal mewarisi venue dari lead-nya — lead harus dalam scope user (403 bila tidak). */
async function requireLeadForDeal(leadId: string, user: SalesFunnelUser, scope: UserScope | null): Promise<LeadForDeal> {
  const lead = await queryOne<LeadForDeal>(
    `SELECT id, company_id, branch_id, owner_user_id, status, org_name
     FROM crm.crm_sales_leads WHERE id = $1 AND deleted_at IS NULL`,
    [leadId]
  );
  if (!lead) throw ApiError.notFound("Lead tidak ditemukan");
  const outOfScope =
    (scope?.companyId && lead.company_id !== scope.companyId) ||
    (scope?.businessScope === "branch" && scope.branchId && lead.branch_id !== scope.branchId) ||
    (user.role === "sales" && lead.owner_user_id !== null && lead.owner_user_id !== user.id);
  if (outOfScope) throw ApiError.forbidden();
  return lead;
}

export async function createDeal(user: SalesFunnelUser, scope: UserScope | null, body: z.infer<typeof createDealSchema>) {
  const lead = await requireLeadForDeal(body.lead_id, user, scope);
  if (body.event_date && !isValidCalendarDate(body.event_date)) {
    throw ApiError.badRequest("Tanggal acara tidak valid");
  }
  await assertOwnerAssignable(user, body.owner_user_id, lead.company_id);

  // EPIC-050 Fase 3: pipeline dipilih (default = pipeline is_default) → tahap pertamanya
  const pipeline = await queryOne<{ id: string }>(
    body.pipeline_id
      ? `SELECT id FROM crm.crm_pipelines WHERE id = $1 AND is_active`
      : `SELECT id FROM crm.crm_pipelines WHERE is_active ORDER BY is_default DESC, sort_order LIMIT 1`,
    body.pipeline_id ? [body.pipeline_id] : []
  );
  if (!pipeline) throw ApiError.badRequest("Pipeline tidak ditemukan / nonaktif");
  const custom = await resolveCustomValues("deal", lead.company_id, body.custom);
  // Deal baru selalu masuk tahap pertama pipeline (bukan menang/kalah)
  const firstStage = await queryOne<{ id: string; probability: number }>(
    `SELECT id, probability FROM crm.crm_sales_stages
     WHERE is_active = true AND is_won = false AND is_lost = false AND pipeline_id = $1
     ORDER BY sort_order ASC LIMIT 1`,
    [pipeline.id]
  );
  if (!firstStage) throw ApiError.badRequest("Tidak ada tahap pipeline aktif");

  // Satu transaksi: deal + riwayat tahap + status lead — retry setelah 500
  // tidak boleh membuat deal dobel, funnel tidak boleh kehilangan riwayat.
  const row = await withTransaction(async (client) => {
    const inserted = await client.query<{ id: string; title: string; stage_id: string }>(
      `INSERT INTO crm.crm_sales_deals
         (company_id, branch_id, lead_id, title, event_type, event_date,
          is_event_date_fixed, pax_estimate, value_estimate, stage_id,
          owner_user_id, created_by, pipeline_id, forecast_category, custom)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
       RETURNING id, title, stage_id`,
      [
        lead.company_id,
        lead.branch_id,
        lead.id,
        body.title,
        body.event_type,
        body.event_date || null,
        body.is_event_date_fixed,
        body.pax_estimate ?? null,
        body.value_estimate ?? null,
        firstStage.id,
        body.owner_user_id || (user.role === "sales" ? user.id : lead.owner_user_id),
        user.id,
        pipeline.id,
        categoryFromStage({ is_won: false, is_lost: false, probability: firstStage.probability }),
        JSON.stringify(custom),
      ]
    );
    const deal = inserted.rows[0];
    // Riwayat tahap (Fase E): deal baru tercatat masuk tahap pertama
    await client.query(
      `INSERT INTO crm.crm_sales_deal_stage_history (deal_id, stage_id, created_by) VALUES ($1, $2, $3)`,
      [deal.id, firstStage.id, user.id]
    );
    // Konversi lead→deal: lead baru/dihubungi otomatis qualified
    if (lead.status === "baru" || lead.status === "dihubungi") {
      await client.query(`UPDATE crm.crm_sales_leads SET status = 'qualified', updated_at = now() WHERE id = $1`, [lead.id]);
    }
    return deal;
  });

  await emitCrmEvent({
    event_type: "deal.created",
    subject_type: "deal",
    subject_id: row.id,
    company_id: lead.company_id,
    branch_id: lead.branch_id,
    actor_user_id: user.id,
    payload: { title: row.title, event_type: body.event_type },
  });
  return { row, orgName: lead.org_name };
}

export async function updateDeal(user: SalesFunnelUser, deal: AccessibleDeal, input: z.infer<typeof updateDealSchema>) {
  const { custom, ...rest } = input;
  let body: DealUpdateFields = { ...rest, event_date: rest.event_date === "" ? null : rest.event_date };
  if (body.event_date && !isValidCalendarDate(body.event_date)) {
    throw ApiError.badRequest("Tanggal acara tidak valid");
  }
  await assertOwnerAssignable(user, body.owner_user_id, deal.company_id);

  const update = createUpdateSet();
  const isStageMove = body.stage_id !== undefined && body.stage_id !== deal.stage_id;
  if (isStageMove) {
    const stage = await queryOne<{
      is_won: boolean;
      is_lost: boolean;
      is_active: boolean;
      pipeline_id: string | null;
      probability: number;
    }>(`SELECT is_won, is_lost, is_active, pipeline_id, probability FROM crm.crm_sales_stages WHERE id = $1`, [
      body.stage_id,
    ]);
    if (!stage || !stage.is_active) throw ApiError.badRequest("Tahap tujuan tidak valid");
    // EPIC-050 Fase 3: tahap di pipeline lain → deal ikut pindah pipeline
    const current = await queryOne<{ pipeline_id: string | null }>(
      `SELECT pipeline_id FROM crm.crm_sales_deals WHERE id = $1`,
      [deal.id]
    );
    if (stage.pipeline_id && current?.pipeline_id && stage.pipeline_id !== current.pipeline_id) {
      update.set("pipeline_id", stage.pipeline_id);
    }
    const plan = planStageMove(stage, body, deal, new Date().toISOString());
    body = plan.body;
    update.setAll(plan.columns);
  }
  if (custom !== undefined) {
    const existing = await loadExistingCustom("crm.crm_sales_deals", deal.id);
    update.set("custom", JSON.stringify(await resolveCustomValues("deal", deal.company_id, custom, existing)), "::jsonb");
  }
  update.setAll(body);
  const { sql, values, idParam } = update.build(deal.id);

  // Satu transaksi: update deal + riwayat tahap — pindah tahap tanpa baris
  // riwayat membuat funnel undercount permanen (temuan gate Fase E)
  const row = await withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE crm.crm_sales_deals SET ${sql}
       WHERE id = ${idParam}
       RETURNING id, title, stage_id, closed_at`,
      values
    );
    if (isStageMove) {
      await client.query(
        `INSERT INTO crm.crm_sales_deal_stage_history (deal_id, stage_id, created_by) VALUES ($1, $2, $3)`,
        [deal.id, body.stage_id, user.id]
      );
    }
    return updated.rows[0] ?? null;
  });

  const eventBase = {
    subject_type: "deal" as const,
    subject_id: deal.id,
    company_id: deal.company_id,
    branch_id: deal.branch_id,
    actor_user_id: user.id,
  };
  if (isStageMove) {
    const toStage = await queryOne<{ code: string; name: string; is_won: boolean; is_lost: boolean }>(
      `SELECT code, name, is_won, is_lost FROM crm.crm_sales_stages WHERE id = $1`,
      [body.stage_id]
    );
    await emitCrmEvent({
      ...eventBase,
      event_type: "deal.stage_changed",
      payload: {
        from_stage_id: deal.stage_id,
        to_stage_id: body.stage_id,
        to_stage: toStage?.code,
        to_stage_name: toStage?.name,
        is_won: toStage?.is_won,
        is_lost: toStage?.is_lost,
      },
      changes: {
        stage_id: { from: deal.stage_id, to: body.stage_id },
        stage_code: { from: undefined, to: toStage?.code },
      },
    });
  } else {
    await emitCrmEvent({
      ...eventBase,
      event_type: "deal.updated",
      payload: {
        changed_fields: Object.entries(body).filter(([, v]) => v !== undefined).map(([k]) => k),
      },
    });
  }
  return row;
}

export async function softDeleteDeal(id: string): Promise<void> {
  await queryOne(`UPDATE crm.crm_sales_deals SET deleted_at = now(), updated_at = now() WHERE id = $1 RETURNING id`, [id]);
}

// ── Deal team (EPIC-050 T-3.1): owner tetap di deals.owner_user_id ──

export const addDealMemberSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(["owner", "support", "pre_sales", "account_manager", "finance"]).default("support"),
  split_percent: z.number().min(0).max(100).default(0),
});

export async function listDealMembers(dealId: string) {
  return query(
    `SELECT m.id, m.user_id, m.role, m.split_percent, m.created_at, u.full_name, u.role AS user_role
     FROM crm.crm_deal_members m JOIN configuration.users u ON u.id = m.user_id
     WHERE m.deal_id = $1 ORDER BY m.created_at`,
    [dealId]
  );
}

export async function addDealMember(
  deal: AccessibleDeal,
  input: z.infer<typeof addDealMemberSchema>,
  actorId: string
) {
  const ownerError = await validateAssignableOwner(input.user_id, deal.company_id);
  if (ownerError) throw ApiError.badRequest(ownerError);
  return queryOne(
    `INSERT INTO crm.crm_deal_members (deal_id, user_id, role, split_percent, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (deal_id, user_id) DO UPDATE SET role = EXCLUDED.role, split_percent = EXCLUDED.split_percent
     RETURNING id, user_id, role, split_percent`,
    [deal.id, input.user_id, input.role, input.split_percent, actorId]
  );
}

export async function removeDealMember(dealId: string, memberId: string): Promise<void> {
  await query(`DELETE FROM crm.crm_deal_members WHERE id = $1 AND deal_id = $2`, [memberId, dealId]);
}

// ── Kirim cepat WA ke PIC (EPIC-022 Fase C) ──

export const sendDealWaSchema = z
  .object({
    template_id: z.string().uuid().optional().nullable(),
    message: z.string().trim().max(2000).optional().nullable(),
  })
  .refine((v) => v.template_id || v.message, { message: "Pilih template atau tulis pesan" });

/** Label acara di dalam kalimat pesan WA (huruf kecil). */
const EVENT_TYPE_MESSAGE_LABELS: Record<string, string> = {
  gathering: "gathering",
  "field-trip": "field trip",
  "ulang-tahun": "acara ulang tahun",
  "buyout-venue": "buyout venue",
  lainnya: "acara",
};

/**
 * Rem anti-spam: gateway = satu nomor WA bersama seluruh platform; maks 1
 * kirim per deal / 60 detik. Dipakai juga oleh kirim quotation.
 */
export async function assertWaCooldown(dealId: string): Promise<void> {
  const recentSend = await queryOne<{ id: string }>(
    `SELECT id FROM crm.crm_sales_activities
     WHERE deal_id = $1 AND activity_type = 'wa' AND deleted_at IS NULL
       AND created_at > now() - interval '60 seconds'
     LIMIT 1`,
    [dealId]
  );
  if (recentSend) throw new ApiError(429, "Tunggu sebentar — pesan ke PIC deal ini baru saja dikirim");
}

export async function requireWaGateway() {
  const config = await loadGatewayConfig();
  if (!config) throw new ApiError(503, "WA gateway belum dikonfigurasi");
  return config;
}

/** Kirim teks via gateway; gagal = 502 dengan alasan gateway. */
export async function sendWaText(config: NonNullable<Awaited<ReturnType<typeof loadGatewayConfig>>>, target: string, message: string) {
  const result = await sendGatewayText(config, { target, message });
  if (!result.success) throw new ApiError(502, result.reason ?? "Gagal mengirim WA");
  return result.messageId ?? null;
}

/**
 * Pesan yang terkirim dicatat sebagai aktivitas `wa` selesai — timeline
 * deal jadi jejak komunikasi.
 */
export async function sendDealWa(user: SalesFunnelUser, deal: AccessibleDeal, input: z.infer<typeof sendDealWaSchema>) {
  const config = await requireWaGateway();
  await assertWaCooldown(deal.id);

  const context = await queryOne<{
    event_type: string;
    event_date: string | null;
    org_name: string;
    pic_name: string;
    pic_phone: string;
    venue_name: string | null;
  }>(
    `SELECT d.event_type, d.event_date, l.org_name, l.pic_name, l.pic_phone, b.name AS venue_name
     FROM crm.crm_sales_deals d
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     LEFT JOIN configuration.branches b ON b.id = d.branch_id
     WHERE d.id = $1`,
    [deal.id]
  );
  if (!context) throw ApiError.notFound("Deal tidak ditemukan");

  let template = input.message?.trim() ?? "";
  if (input.template_id) {
    const row = await queryOne<{ body: string }>(
      `SELECT body FROM crm.crm_sales_wa_templates WHERE id = $1 AND is_active = true`,
      [input.template_id]
    );
    if (!row) throw ApiError.notFound("Template tidak ditemukan");
    template = row.body;
  }
  const message = renderWaTemplate(template, {
    pic: context.pic_name,
    instansi: context.org_name,
    acara: EVENT_TYPE_MESSAGE_LABELS[context.event_type] ?? "acara",
    tanggal_acara: formatDateLong(context.event_date, ""),
    venue: context.venue_name,
  });
  if (!message) throw ApiError.badRequest("Pesan kosong setelah render template");

  // Guard defensif di titik kirim (pola watcher) — jangan percaya data lama
  const target = requireValidPhone(context.pic_phone, "No. WA PIC tidak valid");
  const messageId = await sendWaText(config, target, message);

  await queryOne(
    `INSERT INTO crm.crm_sales_activities
       (company_id, branch_id, deal_id, activity_type, notes, done_at, owner_user_id, created_by)
     VALUES ($1, $2, $3, 'wa', $4, now(), $5, $5)
     RETURNING id`,
    [deal.company_id, deal.branch_id, deal.id, `Kirim WA ke ${context.pic_name}: ${message.slice(0, 500)}`, user.id]
  );
  return { messageId, picName: context.pic_name };
}
