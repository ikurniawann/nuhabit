"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Star } from "lucide-react";
import { angka } from "../format";
import { memberApi, postJson } from "./mobile-api";
import { useLocale, useT } from "./mobile-i18n";
import { BottomSheet } from "./mobile-sheets";
import { EmptyCard, ErrorNote, LoadingNote, OkNote, ScreenTitle, SectionHeader } from "./mobile-ui";

/* ── Data ────────────────────────────────────────────────────────────── */

interface ReviewableOrder {
  id: string;
  order_number: string;
  total_amount: number;
  paid_at: string;
  outlet_name: string | null;
  review_until: string;
}

interface MyReview {
  id: string;
  order_number: string;
  outlet_name: string | null;
  rating: number;
  comment: string | null;
  reply: string | null;
  replied_at: string | null;
  created_at: string;
}

const REVIEWS_KEY = ["member-portal", "reviews"];
const COMMENT_MAX = 1000;

const useMemberReviews = () =>
  useQuery({
    queryKey: REVIEWS_KEY,
    queryFn: () => memberApi<{ eligible: ReviewableOrder[]; reviews: MyReview[] }>("/api/member-portal/reviews"),
  });

function useShortDate() {
  const locale = useLocale();
  return (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
}

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} className={n <= value ? "fill-nh-forest text-nh-forest" : "text-nh-ink/20"} />
      ))}
    </span>
  );
}

/* ── Layar ───────────────────────────────────────────────────────────── */

/**
 * Ulasan member: order lunas 14 hari terakhir yang belum diulas (tombol beri
 * rating) dan ulasan yang sudah dikirim beserta balasan tim outlet.
 */
export function ReviewsScreen() {
  const t = useT();
  const shortDate = useShortDate();
  const { data, isLoading, error } = useMemberReviews();
  const [rating, setRating] = useState<ReviewableOrder | null>(null);
  const [thanks, setThanks] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <ScreenTitle hint={t("Beri rating order 14 hari terakhir. Balasan tim kami muncul di sini.")}>
        {t("Ulasan")}
      </ScreenTitle>
      {isLoading && <LoadingNote />}
      {error && <ErrorNote>{error.message}</ErrorNote>}
      {thanks && <OkNote>{t("Terima kasih! Ulasan Anda sudah kami terima.")}</OkNote>}

      {data && (
        <section>
          <SectionHeader label={t("Menunggu ulasan")} />
          {data.eligible.length === 0 ? (
            <EmptyCard>{t("Tidak ada order yang menunggu ulasan.")}</EmptyCard>
          ) : (
            <div className="flex flex-col gap-3">
              {data.eligible.map((order) => (
                <div key={order.id} className="nh-card flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold tracking-[0.18em] text-nh-muted uppercase">
                      {shortDate(order.paid_at)}
                      {order.outlet_name ? ` · ${order.outlet_name}` : ""}
                    </p>
                    <p className="mt-1 truncate text-sm font-extrabold">{order.order_number}</p>
                    <p className="text-xs text-nh-muted">
                      Rp {angka(order.total_amount)} · {t("ulas sebelum {tanggal}", { tanggal: shortDate(order.review_until) })}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="nh-btn-brand shrink-0 !px-4 !py-2 text-sm"
                    onClick={() => {
                      setThanks(false);
                      setRating(order);
                    }}
                  >
                    {t("Beri rating")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {data && data.reviews.length > 0 && (
        <section>
          <SectionHeader label={t("Ulasan saya")} />
          <div className="flex flex-col gap-3">
            {data.reviews.map((review) => (
              <div key={review.id} className="nh-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Stars value={review.rating} />
                    <p className="mt-1 text-xs text-nh-muted">
                      {review.order_number}
                      {review.outlet_name ? ` · ${review.outlet_name}` : ""} · {shortDate(review.created_at)}
                    </p>
                  </div>
                </div>
                {review.comment && <p className="mt-2 text-sm whitespace-pre-line">{review.comment}</p>}
                {review.reply && (
                  <div className="mt-3 rounded-2xl bg-nh-lime-soft px-4 py-3 text-sm">
                    <p className="flex items-center gap-1.5 text-[11px] font-extrabold tracking-[0.12em] text-nh-forest uppercase">
                      <MessageCircle size={13} /> {t("Balasan outlet")}
                    </p>
                    <p className="mt-1 whitespace-pre-line text-nh-ink">{review.reply}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {rating && (
        <RateSheet
          order={rating}
          onClose={() => setRating(null)}
          onDone={() => {
            setRating(null);
            setThanks(true);
          }}
        />
      )}
    </div>
  );
}

const RATING_HINTS = ["", "Kecewa", "Kurang", "Cukup", "Puas", "Sangat puas"];

function RateSheet({ order, onClose, onDone }: { order: ReviewableOrder; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const submit = useMutation({
    mutationFn: () =>
      postJson("/api/member-portal/reviews", {
        order_id: order.id,
        rating: stars,
        comment: comment.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: REVIEWS_KEY });
      onDone();
    },
  });

  return (
    <BottomSheet kicker={order.order_number} title={t("Bagaimana order Anda?")} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2">
          <div className="flex gap-2" role="radiogroup" aria-label={t("Rating")}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={stars === n}
                aria-label={t("{n} bintang", { n })}
                onClick={() => setStars(n)}
                className="rounded-full p-1 active:scale-95"
              >
                <Star size={36} className={n <= stars ? "fill-nh-forest text-nh-forest" : "text-nh-ink/20"} />
              </button>
            ))}
          </div>
          <p className="h-5 text-sm font-bold text-nh-muted">{stars ? t(RATING_HINTS[stars]) : t("Ketuk bintang")}</p>
        </div>
        <label>
          <span className="nh-label">{t("Komentar (opsional)")}</span>
          <textarea
            value={comment}
            maxLength={COMMENT_MAX}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("Ceritakan rasa, layanan, atau suasananya")}
            className="min-h-24 w-full rounded-2xl border-2 border-transparent bg-nh-raised px-4 py-3 text-base text-nh-ink outline-none placeholder:text-nh-muted focus:border-nh-forest focus:bg-nh-cream"
          />
        </label>
        {submit.error && <ErrorNote>{submit.error.message}</ErrorNote>}
        <button
          type="button"
          className="nh-btn-brand w-full"
          disabled={stars === 0 || submit.isPending}
          onClick={() => submit.mutate()}
        >
          {submit.isPending ? t("Mengirim…") : t("Kirim ulasan")}
        </button>
      </div>
    </BottomSheet>
  );
}
