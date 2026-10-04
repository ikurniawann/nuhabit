"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  EyeOff,
  Loader2,
  MapPin,
  MessageSquareReply,
  Send,
  Star,
  XCircle,
} from "lucide-react";
import { formatDate } from "@/lib/format";
import type { GoogleReview } from "../api";
import { RATING_LABELS, formatReviewWait } from "../helpers";

/**
 * Satu ulasan Google: komentar, balasan terkirim, balasan menunggu/ditolak,
 * dan editor balasan. `draft` null = editor tertutup.
 */
export function ReviewCard({
  review,
  draft,
  busy,
  canApprove,
  showLocation,
  onDraftChange,
  onSend,
  onIgnore,
  onApprove,
  onReject,
}: {
  review: GoogleReview;
  draft: string | null;
  busy: boolean;
  canApprove: boolean;
  showLocation: boolean;
  onDraftChange: (text: string | null) => void;
  onSend: () => void;
  onIgnore: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <article className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">
              {review.reviewer_name}
            </span>
            <Stars value={review.star_rating} />
            {review.is_complaint && (
              <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">
                Komplain
              </span>
            )}
            {review.status === "baru" && review.sla_breached && (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                <AlertTriangle className="size-3" /> Lewat SLA
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            {formatDate(review.review_created_at)}
            {review.status === "baru" &&
              ` · menunggu ${formatReviewWait(review.waiting_seconds)}`}
            {showLocation && review.location_id && (
              <>
                {" · "}
                <MapPin className="inline size-3 align-[-1px]" /> Lokasi{" "}
                {review.location_id}
              </>
            )}
          </p>
        </div>

        {review.status === "baru" && (
          <button
            type="button"
            onClick={onIgnore}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            <EyeOff className="size-3.5" /> Abaikan
          </button>
        )}
      </div>

      {review.comment ? (
        <p className="whitespace-pre-wrap text-sm text-slate-700">
          {review.comment}
        </p>
      ) : (
        <p className="text-sm italic text-slate-400">
          Rating tanpa teks ulasan ({RATING_LABELS[review.star_rating]}).
        </p>
      )}

      {review.reply_comment ? (
        <div className="rounded-lg border-l-2 border-emerald-400 bg-emerald-50/60 px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
            <CheckCircle2 className="size-3" /> Balasan terkirim
            {review.replied_by_name && ` · ${review.replied_by_name}`}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
            {review.reply_comment}
          </p>
          <button
            type="button"
            onClick={() => onDraftChange(review.reply_comment ?? "")}
            className="mt-1.5 text-xs font-medium text-emerald-700 underline underline-offset-2"
          >
            Ubah balasan
          </button>
        </div>
      ) : null}

      {review.reply_approval_status === "pending_approval" &&
        review.pending_reply_comment && (
          <div className="rounded-lg border-l-2 border-amber-400 bg-amber-50/70 px-3 py-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
              <Clock3 className="size-3" /> Menunggu persetujuan
              {review.pending_by_name &&
                ` · diajukan ${review.pending_by_name}`}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
              {review.pending_reply_comment}
            </p>
            {canApprove ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onApprove}
                  disabled={busy}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-3.5" />
                  )}
                  Setujui & Kirim
                </button>
                <button
                  type="button"
                  onClick={onReject}
                  disabled={busy}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  <XCircle className="size-3.5" /> Tolak
                </button>
              </div>
            ) : (
              <p className="mt-1.5 text-[11px] text-amber-700">
                Balasan baru dikirim ke Google setelah disetujui admin/super
                admin.
              </p>
            )}
          </div>
        )}

      {review.reply_approval_status === "rejected" &&
        review.pending_reply_comment && (
          <div className="rounded-lg border-l-2 border-red-300 bg-red-50/60 px-3 py-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-red-700">
              <XCircle className="size-3" /> Balasan ditolak — belum terkirim
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 line-through decoration-red-300">
              {review.pending_reply_comment}
            </p>
            <p className="mt-1 text-[11px] text-red-700">
              Tulis balasan baru lewat tombol Balas untuk diajukan ulang.
            </p>
          </div>
        )}

      {review.reply_approval_status === "pending_approval" ? null : draft !==
        null ? (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
          <textarea
            rows={3}
            autoFocus
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="Tulis balasan yang akan tampil publik di Google..."
            className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <p className="text-[11px] text-slate-500">
            Google hanya menyimpan <strong>satu balasan</strong> per ulasan —
            mengirim lagi akan mengganti balasan sebelumnya, bukan menambah.
          </p>
          {!canApprove && review.star_rating <= 2 && (
            <p className="text-[11px] font-medium text-amber-700">
              Ulasan bintang {review.star_rating}: balasan menunggu persetujuan
              admin/super admin sebelum terkirim ke Google.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onDraftChange(null)}
              className="h-8 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={onSend}
              disabled={busy || !draft.trim()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-slate-950 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              {!canApprove && review.star_rating <= 2
                ? "Ajukan untuk Persetujuan"
                : "Kirim ke Google"}
            </button>
          </div>
        </div>
      ) : (
        review.status !== "dibalas" && (
          <button
            type="button"
            onClick={() => onDraftChange("")}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            <MessageSquareReply className="size-3.5" /> Balas
          </button>
        )
      )}
    </article>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label={`${value} dari 5 bintang`}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`size-3.5 ${
            star <= value ? "fill-amber-400 text-amber-400" : "text-slate-300"
          }`}
        />
      ))}
    </span>
  );
}
