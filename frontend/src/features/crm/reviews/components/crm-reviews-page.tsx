"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Link2, Loader2, RefreshCw, ShieldAlert, Star } from "lucide-react";
import type { GoogleReview, ReviewAction, ReviewActionResult, ReviewFilters } from "../api";
import { useReviewAction, useReviews } from "../queries";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { GoogleConnectPanel } from "./google-connect-panel";
import { ReviewCard } from "./review-card";

/**
 * EPIC-013 Fase A — Google Review: baca & balas dari dashboard.
 *
 * Catatan penting yang harus terlihat agent: satu ulasan hanya boleh punya
 * SATU balasan — mengirim lagi MENGGANTI balasan sebelumnya di Google, bukan
 * menambah. UI menegaskan ini agar tidak dikira ruang chat.
 */

type Feedback = { error: string | null; message: string | null };

const NO_FEEDBACK: Feedback = { error: null, message: null };

export function CrmReviewsPage() {
  const [filters, setFilters] = useState<ReviewFilters>({ status: "baru", rating: "all", location: "all" });
  const reviewsQuery = useReviews(useDebouncedValue(filters, 200));
  const actionMutation = useReviewAction();
  const [showConnect, setShowConnect] = useState(false);
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(NO_FEEDBACK);

  const reviews = reviewsQuery.data?.reviews ?? [];
  const summary = reviewsQuery.data?.summary ?? null;
  const integration = reviewsQuery.data?.integration ?? null;
  const locations = reviewsQuery.data?.locations ?? [];
  const canApprove = reviewsQuery.data?.canApprove ?? false;
  const loadError = reviewsQuery.error instanceof Error ? reviewsQuery.error.message : null;
  const bannerError = feedback.error ?? loadError;
  const syncing = actionMutation.isPending && actionMutation.variables?.action === "sync";
  const busyId =
    actionMutation.isPending && actionMutation.variables && "id" in actionMutation.variables
      ? actionMutation.variables.id
      : null;

  const setFilter = (patch: Partial<ReviewFilters>) => setFilters((current) => ({ ...current, ...patch }));

  /** Jalankan aksi; sukses → pesan, gagal → error di banner. */
  async function act(body: ReviewAction, successMessage: (result: ReviewActionResult) => string | null) {
    setFeedback(NO_FEEDBACK);
    try {
      const result = await actionMutation.mutateAsync(body);
      setFeedback({ error: null, message: successMessage(result) });
      return true;
    } catch (error) {
      setFeedback({ error: error instanceof Error ? error.message : "Gagal memproses", message: null });
      return false;
    }
  }

  const sync = () =>
    act({ action: "sync" }, (result) =>
      result === true
        ? null
        : `Sinkronisasi selesai — ${result.inserted} ulasan baru, ${result.updated} diperbarui.`
    );

  async function sendReply(review: GoogleReview) {
    if (!draft || draft.id !== review.id || !draft.text.trim()) return;
    const sent = await act({ action: "reply", id: review.id, comment: draft.text }, (result) =>
      result !== true && result.pending
        ? "Balasan disimpan — menunggu persetujuan admin/super admin sebelum dikirim ke Google."
        : "Balasan terkirim ke Google."
    );
    if (sent) setDraft(null);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/dashboard/crm" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900">
              <ArrowLeft className="size-4" /> CRM Dashboard
            </Link>
            <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold text-slate-950">
              <Star className="size-6 fill-amber-400 text-amber-400" />
              Google Review
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Balasan dikirim langsung ke Google dan tampil publik.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void sync()}
            disabled={syncing}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-60"
          >
            <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />
            Tarik Ulasan
          </button>
        </div>

        {integration && !integration.configured && !showConnect && (
          <div className="flex flex-wrap items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 flex-1">
              <strong className="font-semibold">Integrasi Google belum terhubung.</strong> Ulasan
              belum bisa ditarik dan balasan belum bisa dikirim.
            </span>
            <button
              type="button"
              onClick={() => setShowConnect(true)}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-amber-600 px-3 text-xs font-semibold text-white transition hover:bg-amber-700"
            >
              <Link2 className="size-3.5" /> Hubungkan Sekarang
            </button>
          </div>
        )}

        {(showConnect || integration?.configured) && (
          <>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowConnect((current) => !current)}
                className="text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-slate-800"
              >
                {showConnect ? "Sembunyikan pengaturan koneksi" : "Pengaturan koneksi Google"}
              </button>
            </div>
            {showConnect && <GoogleConnectPanel />}
          </>
        )}

        {(bannerError || feedback.message) && (
          <div
            className={`rounded-md border px-4 py-3 text-sm ${
              bannerError
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {bannerError || feedback.message}
          </div>
        )}

        {summary && (
          <div className="grid gap-3 sm:grid-cols-4">
            <SummaryCard label="Total ulasan" value={String(summary.total)} />
            <SummaryCard
              label="Belum dibalas"
              value={String(summary.belum_dibalas)}
              tone={summary.belum_dibalas > 0 ? "amber" : "default"}
            />
            <SummaryCard
              label="Komplain terbuka"
              value={String(summary.komplain_terbuka)}
              tone={summary.komplain_terbuka > 0 ? "red" : "default"}
            />
            <SummaryCard
              label="Rata-rata rating"
              value={summary.rata_rating ? `${Number(summary.rata_rating).toFixed(1)}/5` : "-"}
            />
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div
            className={`grid gap-3 border-b border-slate-200 p-4 ${
              locations.length > 1 ? "sm:grid-cols-3" : "sm:grid-cols-2"
            }`}
          >
            <select
              value={filters.status}
              onChange={(event) => setFilter({ status: event.target.value })}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none"
            >
              <option value="baru">Belum dibalas</option>
              <option value="dibalas">Sudah dibalas</option>
              <option value="diabaikan">Diabaikan</option>
              <option value="all">Semua status</option>
            </select>
            <select
              value={filters.rating}
              onChange={(event) => setFilter({ rating: event.target.value })}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none"
            >
              <option value="all">Semua rating</option>
              {[5, 4, 3, 2, 1].map((star) => (
                <option key={star} value={star}>{star} bintang</option>
              ))}
            </select>
            {locations.length > 1 && (
              <select
                value={filters.location}
                onChange={(event) => setFilter({ location: event.target.value })}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none"
              >
                <option value="all">Semua lokasi</option>
                {locations.map((loc) => (
                  <option key={loc.location_id} value={loc.location_id}>
                    Lokasi {loc.location_id} ({loc.total})
                  </option>
                ))}
              </select>
            )}
          </div>

          {reviewsQuery.isLoading ? (
            <div className="flex justify-center py-14">
              <Loader2 className="size-6 animate-spin text-slate-400" />
            </div>
          ) : reviews.length === 0 ? (
            <div className="px-4 py-14 text-center text-sm text-slate-500">
              Belum ada ulasan pada filter ini.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {reviews.map((review) => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  draft={draft?.id === review.id ? draft.text : null}
                  busy={busyId === review.id}
                  canApprove={canApprove}
                  showLocation={locations.length > 1}
                  onDraftChange={(text) => setDraft(text === null ? null : { id: review.id, text })}
                  onSend={() => void sendReply(review)}
                  onIgnore={() => void act({ action: "ignore", id: review.id }, () => null)}
                  onApprove={() =>
                    void act({ action: "approve_reply", id: review.id }, () => "Balasan disetujui & terkirim ke Google.")
                  }
                  onReject={() =>
                    void act({ action: "reject_reply", id: review.id }, () => "Balasan ditolak — agent bisa merevisi.")
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "amber" | "red";
}) {
  const tones = {
    default: "text-slate-950",
    amber: "text-amber-700",
    red: "text-red-700",
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`text-2xl font-semibold ${tones[tone]}`}>{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}
