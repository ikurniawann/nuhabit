import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { getCrmDefaultVenue, requireCrmCampaign } from "@/lib/crm/server";
import { createPgClient } from "@/lib/pg/create-client";
import { query, queryOne, withTransaction } from "@/lib/db";
import {
  isSafeLink,
  normalizeChannels,
  normalizeSegment,
  SCHEDULE_ISSUE_MESSAGES,
  validateSchedule,
} from "@/lib/crm/campaigns";
import {
  startCampaign,
  STARTABLE_CAMPAIGN_COLUMNS,
  type StartableCampaign,
} from "@/lib/crm/campaigns-server";

// EPIC-033 — aksi satu kampanye: edit (draft), start (build antrean →
// sending), schedule (kirim nanti), pause/resume, cancel. Build antrean
// idempoten; PENGIRIMAN WA tetap di tangan watcher + master switch.

const patchSchema = z.object({
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
  link_url: z.string().trim().max(500).refine(isSafeLink, "Tautan tidak valid").nullable().optional(),
});

const conflict = (error: string) =>
  NextResponse.json({ success: false, error }, { status: 409 });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireCrmCampaign();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;
    const venue = await getCrmDefaultVenue(createPgClient());
    const campaign = await queryOne<StartableCampaign>(
      `SELECT ${STARTABLE_CAMPAIGN_COLUMNS}
       FROM crm.crm_campaigns WHERE id = $1 AND branch_id = $2`,
      [id, venue.branchId]
    );
    if (!campaign) {
      return NextResponse.json(
        { success: false, error: "Kampanye tidak ditemukan" },
        { status: 404 }
      );
    }

    if (body.action === "start") {
      // Kunci baris: watcher bisa memulai kampanye terjadwal yang sama.
      const result = await withTransaction(async (client) => {
        const { rows } = await client.query<{ status: string }>(
          `SELECT status FROM crm.crm_campaigns WHERE id = $1 FOR UPDATE`,
          [id]
        );
        if (!["draft", "paused", "scheduled"].includes(rows[0]?.status ?? "")) return null;
        return startCampaign(client, campaign);
      });
      if (!result) return conflict("Status kampanye sudah berubah — muat ulang halaman");
      const parts = [`${result.inserted} penerima baru`];
      if (result.inApp > 0) parts.push(`${result.inApp} notifikasi in-app terkirim`);
      return successResponse(
        { id, ...result },
        result.status === "sending"
          ? `Kampanye dimulai: ${parts.join(", ")}. WA mengikuti master switch & jam kirim.`
          : `Kampanye selesai: ${parts.join(", ")}.`
      );
    }

    if (body.action === "schedule") {
      if (!["draft", "scheduled"].includes(campaign.status)) {
        return conflict("Hanya kampanye draft yang bisa dijadwalkan");
      }
      const schedule = validateSchedule(body.scheduled_at ?? "", new Date());
      if (!schedule.ok) {
        return NextResponse.json(
          { success: false, error: SCHEDULE_ISSUE_MESSAGES[schedule.reason] },
          { status: 400 }
        );
      }
      await query(
        `UPDATE crm.crm_campaigns SET status = 'scheduled', scheduled_at = $2, updated_at = now()
         WHERE id = $1 AND status IN ('draft', 'scheduled')`,
        [id, schedule.at]
      );
      return successResponse({ id, scheduled_at: schedule.at.toISOString() }, "Kampanye dijadwalkan");
    }

    if (body.action === "pause") {
      await query(
        `UPDATE crm.crm_campaigns SET status = 'paused', updated_at = now()
         WHERE id = $1 AND status = 'sending'`,
        [id]
      );
      return successResponse({ id }, "Kampanye dijeda");
    }
    if (body.action === "cancel") {
      await query(
        `UPDATE crm.crm_campaigns SET status = 'cancelled', updated_at = now()
         WHERE id = $1 AND status IN ('draft', 'scheduled', 'sending', 'paused', 'failed')`,
        [id]
      );
      return successResponse({ id }, "Kampanye dibatalkan");
    }
    if (body.action === "resume") {
      // Kampanye failed dilanjutkan setelah gateway dibereskan; antrean tetap.
      await query(
        `UPDATE crm.crm_campaigns SET status = 'sending', failure_reason = NULL, updated_at = now()
         WHERE id = $1 AND status IN ('paused', 'failed') AND recipients_built`,
        [id]
      );
      return successResponse({ id }, "Kampanye dilanjutkan");
    }

    // Edit field — hanya draft (antrean belum dibangun dari segmen lama)
    if (campaign.status !== "draft") {
      return conflict("Hanya kampanye draft yang bisa diedit — jeda/batalkan dulu");
    }
    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (body.name !== undefined) add("name", body.name);
    if (body.message_template !== undefined) {
      add("message_template", body.message_template);
    }
    if (body.segment_id !== undefined) add("segment_id", body.segment_id ?? null);
    if (body.segment !== undefined) {
      add("segment", JSON.stringify(normalizeSegment(body.segment)));
    }
    if (body.daily_cap !== undefined) add("daily_cap", body.daily_cap);
    if (body.channels !== undefined) add("channels", normalizeChannels(body.channels));
    if (body.inapp_title !== undefined) add("inapp_title", body.inapp_title || null);
    if (body.image_url !== undefined) add("image_url", body.image_url || null);
    if (body.link_url !== undefined) add("link_url", body.link_url || null);
    values.push(id);
    await query(
      `UPDATE crm.crm_campaigns SET ${sets.join(", ")} WHERE id = $${values.length}`,
      values
    );
    return successResponse({ id }, "Kampanye diperbarui");
  } catch (err) {
    console.error("[crm-campaign] patch error:", err);
    return NextResponse.json(
      { success: false, error: (err as Error).message || "Gagal memperbarui kampanye" },
      { status: 500 }
    );
  }
}
