import "server-only";
/**
 * EPIC-013 Fase A — daftar Google Review untuk agent CS dan aksi atas ulasan
 * (balas, setujui/tolak balasan, abaikan). Sinkron & kirim balasan ada di
 * google-reviews-server.
 */
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { getPool } from "@/lib/db";
import { googleBusinessStatus } from "./google-business-client";
import { evaluateReviewSla } from "./google-reviews";
import {
  approvePendingReply,
  getGoogleReviewSettings,
  rejectPendingReply,
  submitReply,
} from "./google-reviews-server";

export type GoogleReviewFilter = { status: string | null; rating: string | null; location: string | null };

export async function listGoogleReviews(filter: GoogleReviewFilter, canApprove: boolean) {
  const values: unknown[] = [];
  const filters: string[] = [];
  const rating = Number(filter.rating);

  if (filter.status && filter.status !== "all") {
    values.push(filter.status);
    filters.push(`r.status = $${values.length}`);
  }
  if (Number.isFinite(rating) && rating >= 1 && rating <= 5) {
    values.push(rating);
    filters.push(`r.star_rating = $${values.length}`);
  }
  if (filter.location && filter.location !== "all") {
    values.push(filter.location);
    filters.push(`r.location_id = $${values.length}`);
  }

  const pool = getPool();
  const settings = await getGoogleReviewSettings(pool);

  const { rows } = await pool.query(
    `SELECT r.id, r.reviewer_name, r.reviewer_photo_url, r.star_rating, r.comment,
            r.review_created_at, r.reply_comment, r.reply_updated_at,
            r.status, r.is_complaint, r.first_reply_seconds, r.location_id,
            r.pending_reply_comment, r.reply_approval_status,
            u.full_name AS replied_by_name,
            pu.full_name AS pending_by_name
       FROM crm.google_reviews r
       LEFT JOIN configuration.users u ON u.id = r.replied_by_user_id
       LEFT JOIN configuration.users pu ON pu.id = r.pending_reply_user_id
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY r.review_created_at DESC
      LIMIT 100`,
    values
  );

  const { rows: summaryRows } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'baru')::int AS belum_dibalas,
            COUNT(*) FILTER (WHERE is_complaint AND status = 'baru')::int AS komplain_terbuka,
            COUNT(*) FILTER (WHERE reply_approval_status = 'pending_approval')::int
              AS menunggu_persetujuan,
            AVG(star_rating)::numeric(3,2) AS rata_rating,
            AVG(first_reply_seconds) FILTER (WHERE first_reply_seconds IS NOT NULL)
              AS rata_waktu_balas
       FROM crm.google_reviews`
  );

  // Daftar lokasi untuk filter — hanya berarti bila multi-lokasi.
  const { rows: locationRows } = await pool.query(
    `SELECT location_id, COUNT(*)::int AS total
       FROM crm.google_reviews
      WHERE location_id IS NOT NULL
      GROUP BY location_id
      ORDER BY location_id`
  );

  // SLA dihitung saat dibaca supaya perubahan konfigurasi langsung terasa
  // tanpa perlu menunggu job berikutnya.
  const now = new Date();
  const reviews = rows.map((row) => {
    const sla = evaluateReviewSla(
      row.review_created_at,
      settings.slaReplyMinutes,
      row.reply_updated_at ? new Date(row.reply_updated_at) : null,
      now
    );
    return { ...row, sla_breached: sla?.breached ?? false, waiting_seconds: sla?.waitingSeconds ?? 0 };
  });

  return {
    reviews,
    summary: summaryRows[0],
    locations: locationRows,
    settings,
    integration: await googleBusinessStatus(),
    viewer: { canApprove },
  };
}

export const reviewActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reply"),
    id: z.string().uuid(),
    comment: z.string().trim().min(1).max(4000),
  }),
  z.object({ action: z.literal("approve_reply"), id: z.string().uuid() }),
  z.object({ action: z.literal("reject_reply"), id: z.string().uuid() }),
  z.object({ action: z.literal("ignore"), id: z.string().uuid() }),
  z.object({ action: z.literal("sync") }),
]);
type ReviewAction = Exclude<z.infer<typeof reviewActionSchema>, { action: "sync" }>;

/**
 * Aksi atas satu ulasan. Balasan ulasan rating <= 2 dari non-approver masuk
 * antrean persetujuan; hanya approver yang boleh menyetujui/menolak.
 * Mengembalikan `{ pending }` untuk balasan, null untuk aksi lain.
 */
export async function applyGoogleReviewAction(
  payload: ReviewAction,
  actor: { id: string; canApprove: boolean }
): Promise<{ pending: boolean } | null> {
  const pool = getPool();
  if (payload.action === "ignore") {
    await pool.query(`UPDATE crm.google_reviews SET status = 'diabaikan' WHERE id = $1`, [payload.id]);
    return null;
  }

  if (payload.action === "approve_reply" || payload.action === "reject_reply") {
    if (!actor.canApprove) {
      throw ApiError.forbidden("Hanya admin/super admin yang boleh menyetujui balasan");
    }
    const result =
      payload.action === "approve_reply"
        ? await approvePendingReply(payload.id, actor.id, pool)
        : await rejectPendingReply(payload.id, actor.id, pool);
    if (!result.ok) throw new ApiError(result.status, result.error);
    return null;
  }

  const result = await submitReply(payload.id, payload.comment, actor, pool);
  if (!result.ok) throw new ApiError(result.status, result.error);
  return { pending: result.pending };
}
