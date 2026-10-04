import "server-only";
/**
 * EPIC-013 Fase A — sinkronisasi & penyimpanan Google Review.
 *
 * Idempoten berdasarkan `review_id` (segmen terakhir resource name), BUKAN
 * nama resource penuh — nama penuh memuat id akun, sehingga ganti akun Google
 * akan menggandakan ulasan yang sama. Sinkronisasi berulang memperbarui
 * ulasan yang berubah tanpa menggandakan baris, dan tidak menimpa status
 * kerja kita.
 */

import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import { fetchReviews, putReviewReply } from "./google-business-client";
import {
  isComplaintRating,
  needsReplyApproval,
  normalizeReview,
  validateReply,
  type NormalizedReview,
} from "./google-reviews";
import {
  buildReviewRendahMessage,
  reviewRendahDedupKey,
} from "@/lib/wa/notifications-messages";
import { fireOwnerNotification } from "@/lib/wa/notifications-sender";

export interface GoogleReviewSettings {
  complaintMaxRating: number;
  slaReplyMinutes: number;
  syncEnabled: boolean;
}

function readNumber(raw: unknown, fallback: number): number {
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function getGoogleReviewSettings(
  db: Pool = getPool()
): Promise<GoogleReviewSettings> {
  const { rows } = await db.query(
    `SELECT key, value FROM crm.crm_settings WHERE key LIKE 'gr_%'`
  );
  const map = new Map<string, unknown>(rows.map((row) => [row.key, row.value]));

  return {
    complaintMaxRating: readNumber(map.get("gr_complaint_max_rating"), 3),
    slaReplyMinutes: readNumber(map.get("gr_sla_reply_minutes"), 1440),
    syncEnabled: map.get("gr_sync_enabled") !== false,
  };
}

export interface SyncSummary {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  error?: string;
  notConfigured?: boolean;
}

/** Simpan satu ulasan; mengembalikan 'inserted' | 'updated' | 'skipped'. */
async function upsertReview(
  db: Pool,
  review: NormalizedReview,
  settings: GoogleReviewSettings
): Promise<"inserted" | "updated"> {
  const isComplaint = isComplaintRating(review.starRating, settings.complaintMaxRating);

  const { rows } = await db.query(
    `INSERT INTO crm.google_reviews
       (review_id, review_name, location_id, reviewer_name, reviewer_photo_url, star_rating, comment,
        review_created_at, review_updated_at, reply_comment, reply_updated_at,
        status, is_complaint, synced_at)
     VALUES ($11, $1, $12, $2, $3, $4, $5, $6, $7, $8, $9,
             CASE WHEN $8::text IS NOT NULL THEN 'dibalas' ELSE 'baru' END, $10, now())
     ON CONFLICT (review_id) DO UPDATE SET
       -- Resource path memuat id akun; segarkan agar balasan tetap terkirim
       -- ke path yang benar setelah kredensial diganti ke akun lain.
       review_name = EXCLUDED.review_name,
       location_id = COALESCE(EXCLUDED.location_id, crm.google_reviews.location_id),
       -- Isi ulasan bisa diedit pengulas — ikut diperbarui.
       reviewer_name = EXCLUDED.reviewer_name,
       reviewer_photo_url = EXCLUDED.reviewer_photo_url,
       star_rating = EXCLUDED.star_rating,
       comment = EXCLUDED.comment,
       review_updated_at = EXCLUDED.review_updated_at,
       is_complaint = EXCLUDED.is_complaint,
       -- Balasan dari Google hanya menimpa bila kita belum punya catatan
       -- balasan (mis. dibalas lewat aplikasi Google, bukan dashboard ini).
       reply_comment = COALESCE(crm.google_reviews.reply_comment, EXCLUDED.reply_comment),
       reply_updated_at = COALESCE(crm.google_reviews.reply_updated_at, EXCLUDED.reply_updated_at),
       status = CASE
         WHEN crm.google_reviews.status = 'diabaikan' THEN 'diabaikan'
         WHEN COALESCE(crm.google_reviews.reply_comment, EXCLUDED.reply_comment) IS NOT NULL
           THEN 'dibalas'
         ELSE 'baru'
       END,
       synced_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [
      review.reviewName,
      review.reviewerName,
      review.reviewerPhotoUrl,
      review.starRating,
      review.comment,
      review.createdAt,
      review.updatedAt,
      review.replyComment,
      review.replyUpdatedAt,
      isComplaint,
      review.reviewId,
      review.locationId,
    ]
  );

  return rows[0]?.inserted ? "inserted" : "updated";
}

export async function syncGoogleReviews(db: Pool = getPool()): Promise<SyncSummary> {
  const settings = await getGoogleReviewSettings(db);
  if (!settings.syncEnabled) {
    return { fetched: 0, inserted: 0, updated: 0, skipped: 0, error: "Sinkronisasi dinonaktifkan" };
  }

  const result = await fetchReviews();
  if (!result.ok) {
    return {
      fetched: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      error: result.reason,
      notConfigured: result.notConfigured,
    };
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const resource of result.data) {
    const normalized = normalizeReview(resource);
    if (!normalized) {
      skipped += 1;
      continue;
    }
    try {
      const outcome = await upsertReview(db, normalized, settings);
      if (outcome === "inserted") inserted += 1;
      else updated += 1;
      // EPIC-020 Fase C: review BARU ber-bintang ≤2 → WA owner. Hanya saat
      // insert (edit review lama tidak memicu ulang); dedup per review id
      // jadi restart sync pun aman. Tembak-dan-lupakan — gagal WA tidak
      // menggagalkan sync.
      if (outcome === "inserted" && normalized.starRating <= 2) {
        fireOwnerNotification({
          type: "reviewRendah",
          dedupKey: reviewRendahDedupKey(normalized.reviewId),
          message: buildReviewRendahMessage({
            reviewerName: normalized.reviewerName,
            starRating: normalized.starRating,
            comment: normalized.comment,
          }),
        });
      }
    } catch (error) {
      skipped += 1;
      console.error(
        "[google-reviews] Gagal menyimpan ulasan:",
        error instanceof Error ? error.message : error
      );
    }
  }

  return { fetched: result.data.length, inserted, updated, skipped };
}

export type ReplyResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Kirim balasan ke Google lalu catat di DB.
 *
 * Urutannya disengaja: kirim dulu, simpan setelah Google menerima — supaya
 * dashboard tidak pernah menampilkan balasan yang sebenarnya gagal terkirim.
 */
export async function replyToReview(
  reviewId: string,
  comment: string,
  userId: string,
  db: Pool = getPool()
): Promise<ReplyResult> {
  const validation = validateReply(comment);
  if (!validation.valid) {
    return { ok: false, status: 400, error: validation.error ?? "Balasan tidak valid" };
  }

  const { rows } = await db.query(
    `SELECT review_name, review_created_at, reply_comment
       FROM crm.google_reviews WHERE id = $1`,
    [reviewId]
  );
  const review = rows[0];
  if (!review) return { ok: false, status: 404, error: "Ulasan tidak ditemukan" };

  const sent = await putReviewReply(review.review_name, comment.trim());
  if (!sent.ok) {
    return {
      ok: false,
      status: sent.notConfigured ? 409 : 502,
      error: sent.reason,
    };
  }

  await db.query(
    `UPDATE crm.google_reviews
        SET reply_comment = $2,
            reply_updated_at = now(),
            replied_by_user_id = $3,
            status = 'dibalas',
            sla_breached = false,
            -- Kirim langsung menggantikan draft/penolakan apa pun yang tersisa.
            pending_reply_comment = NULL,
            reply_approval_status = NULL,
            -- Durasi balas pertama hanya dicatat sekali.
            first_reply_seconds = COALESCE(
              first_reply_seconds,
              GREATEST(0, EXTRACT(EPOCH FROM (now() - review_created_at))::int)
            )
      WHERE id = $1`,
    [reviewId, comment.trim(), userId]
  );

  return { ok: true };
}

export type SubmitReplyResult =
  | { ok: true; pending: boolean }
  | { ok: false; status: number; error: string };

/**
 * Titik masuk tunggal pengiriman balasan (EPIC-013 — approval supervisor).
 *
 * Ulasan ber-rating <= 2 dari agent non-approver TIDAK langsung dikirim ke
 * Google: disimpan sebagai draft `pending_approval` menunggu persetujuan
 * super_admin/admin. Selain itu jalurnya tetap kirim-langsung lama.
 */
export async function submitReply(
  reviewId: string,
  comment: string,
  actor: { id: string; canApprove: boolean },
  db: Pool = getPool()
): Promise<SubmitReplyResult> {
  const validation = validateReply(comment);
  if (!validation.valid) {
    return { ok: false, status: 400, error: validation.error ?? "Balasan tidak valid" };
  }

  const { rows } = await db.query(
    `SELECT star_rating FROM crm.google_reviews WHERE id = $1`,
    [reviewId]
  );
  if (!rows[0]) return { ok: false, status: 404, error: "Ulasan tidak ditemukan" };

  if (!needsReplyApproval(Number(rows[0].star_rating), actor.canApprove)) {
    const direct = await replyToReview(reviewId, comment, actor.id, db);
    return direct.ok ? { ok: true, pending: false } : direct;
  }

  await db.query(
    `UPDATE crm.google_reviews
        SET pending_reply_comment = $2,
            pending_reply_user_id = $3,
            pending_reply_at = now(),
            reply_approval_status = 'pending_approval'
      WHERE id = $1`,
    [reviewId, comment.trim(), actor.id]
  );

  return { ok: true, pending: true };
}

/**
 * Setujui draft: kirim ke Google DULU (pola yang sama dengan balasan
 * langsung), baru catat sebagai balasan resmi. Yang tercatat sebagai pembalas
 * tetap agent penulis draft; approver tercatat terpisah.
 */
export async function approvePendingReply(
  reviewId: string,
  approverUserId: string,
  db: Pool = getPool()
): Promise<ReplyResult> {
  const { rows } = await db.query(
    `SELECT review_name, pending_reply_comment
       FROM crm.google_reviews
      WHERE id = $1 AND reply_approval_status = 'pending_approval'`,
    [reviewId]
  );
  const review = rows[0];
  if (!review?.pending_reply_comment) {
    return { ok: false, status: 404, error: "Tidak ada balasan yang menunggu persetujuan" };
  }

  const sent = await putReviewReply(review.review_name, review.pending_reply_comment);
  if (!sent.ok) {
    return { ok: false, status: sent.notConfigured ? 409 : 502, error: sent.reason };
  }

  await db.query(
    `UPDATE crm.google_reviews
        SET reply_comment = pending_reply_comment,
            reply_updated_at = now(),
            replied_by_user_id = COALESCE(pending_reply_user_id, replied_by_user_id),
            status = 'dibalas',
            sla_breached = false,
            first_reply_seconds = COALESCE(
              first_reply_seconds,
              GREATEST(0, EXTRACT(EPOCH FROM (now() - review_created_at))::int)
            ),
            reply_approval_status = 'approved',
            reply_approved_by_user_id = $2,
            reply_approved_at = now(),
            pending_reply_comment = NULL
      WHERE id = $1`,
    [reviewId, approverUserId]
  );

  return { ok: true };
}

/**
 * Tolak draft. Teks draft SENGAJA dipertahankan supaya agent bisa membaca
 * dan merevisi; mengajukan balasan baru menimpanya.
 */
export async function rejectPendingReply(
  reviewId: string,
  approverUserId: string,
  db: Pool = getPool()
): Promise<ReplyResult> {
  const { rows } = await db.query(
    `UPDATE crm.google_reviews
        SET reply_approval_status = 'rejected',
            reply_approved_by_user_id = $2,
            reply_approved_at = now()
      WHERE id = $1 AND reply_approval_status = 'pending_approval'
      RETURNING id`,
    [reviewId, approverUserId]
  );
  if (!rows[0]) {
    return { ok: false, status: 404, error: "Tidak ada balasan yang menunggu persetujuan" };
  }
  return { ok: true };
}
