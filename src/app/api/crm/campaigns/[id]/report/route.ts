import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { getCrmDefaultVenue, requireCrmCampaign } from "@/lib/crm/server";
import { createPgClient } from "@/lib/pg/create-client";
import { queryOne } from "@/lib/db";

// EPIC-033 Fase C — funnel kampanye: antrean → terkirim → voucher dipakai
// (konversi GRATIS dari promo_redemptions EPIC-032, tanpa tracking baru).
// Mode batch: cocokkan kode voucher penerima; mode public: cocokkan nomor
// WA penerima dgn phone redemption campaign promo terlampir.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireCrmCampaign();
  if (error) return error;

  try {
    const { id } = await params;
    const venue = await getCrmDefaultVenue(createPgClient());
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
    if (!campaign) {
      return NextResponse.json(
        { success: false, error: "Kampanye tidak ditemukan" },
        { status: 404 }
      );
    }

    const counts = await queryOne<{
      total: string;
      pending: string;
      sent: string;
      failed: string;
      skipped: string;
    }>(
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

    let redeemed = 0;
    let redeemedValue = 0;
    if (campaign.promo_campaign_id) {
      if (campaign.promo_mode === "batch") {
        const row = await queryOne<{ n: string; nilai: string }>(
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
        );
        redeemed = Number(row?.n ?? 0);
        redeemedValue = Number(row?.nilai ?? 0);
      } else {
        const row = await queryOne<{ n: string; nilai: string }>(
          `SELECT COUNT(*) AS n, COALESCE(SUM(r.discount_amount), 0) AS nilai
           FROM promo.promo_redemptions r
           WHERE r.campaign_id = $2 AND r.status <> 'released'
             AND r.phone IN (
               SELECT phone FROM crm.crm_campaign_recipients
               WHERE campaign_id = $1 AND status = 'sent'
             )`,
          [id, campaign.promo_campaign_id]
        );
        redeemed = Number(row?.n ?? 0);
        redeemedValue = Number(row?.nilai ?? 0);
      }
    }

    return successResponse({
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
        redeemed,
        redeemed_value: redeemedValue,
      },
      in_app: {
        sent: Number(inApp?.sent ?? 0),
        opened: Number(inApp?.opened ?? 0),
        clicked: Number(inApp?.clicked ?? 0),
      },
    });
  } catch (err) {
    console.error("[crm-campaign] report error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat laporan kampanye" },
      { status: 500 }
    );
  }
}
