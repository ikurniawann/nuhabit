"use client";

import { MessageCircle, Star } from "lucide-react";
import { useState } from "react";
import { formatRupiah } from "@/lib/format";
import { BottomSheet } from "../components/bottom-sheet";
import { ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { loyaltyKeys, submitReview, useRefresh, useReviews, type ReviewableOrder } from "../lib/queries-loyalty";
import { EmptyState, Spinner, formatDay } from "../ui";
import { Notice, PageTitle, SectionHeader } from "./loyalty-ui";

const COMMENT_MAX = 1000;
const RATING_HINTS = ["", "Disappointed", "Not great", "Okay", "Happy", "Very happy"];

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={14} className={n <= value ? "fill-nh-forest text-nh-forest" : "text-nh-ink/20"} />
      ))}
    </span>
  );
}

/** Order lunas 14 hari terakhir yang belum diulas, plus ulasan terkirim beserta balasan outlet. */
export function ReviewsPage() {
  const t = useT();
  const { data, isLoading, error: loadError } = useReviews();
  const [rating, setRating] = useState<ReviewableOrder | null>(null);
  const [thanks, setThanks] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <PageTitle hint={t("Rate orders from the last 14 days. Our team's replies show up here.")}>
        {t("Reviews")}
      </PageTitle>
      {isLoading ? <Spinner label={t("Loading reviews…")} /> : null}
      {loadError ? <Notice ok={false}>{loadError.message}</Notice> : null}
      {thanks ? <Notice ok>{t("Thank you! We received your review.")}</Notice> : null}

      {data ? (
        <section>
          <SectionHeader label={t("Waiting for your review")} />
          {data.eligible.length === 0 ? (
            <EmptyState title={t("No orders waiting for a review.")} />
          ) : (
            <div className="flex flex-col gap-3">
              {data.eligible.map((order) => (
                <div key={order.id} className="nh-card flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold tracking-[0.18em] text-nh-muted uppercase">
                      {formatDay(order.paid_at)}
                      {order.outlet_name ? ` · ${order.outlet_name}` : ""}
                    </p>
                    <p className="mt-1 truncate text-sm font-extrabold">{order.order_number}</p>
                    <p className="text-xs text-nh-muted">
                      {formatRupiah(order.total_amount)} · {t("review by {date}", { date: formatDay(order.review_until) })}
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
                    {t("Rate")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {data && data.reviews.length > 0 ? (
        <section>
          <SectionHeader label={t("My reviews")} />
          <div className="flex flex-col gap-3">
            {data.reviews.map((review) => (
              <div key={review.id} className="nh-card">
                <Stars value={review.rating} />
                <p className="mt-1 text-xs text-nh-muted">
                  {review.order_number}
                  {review.outlet_name ? ` · ${review.outlet_name}` : ""} · {formatDay(review.created_at)}
                </p>
                {review.comment ? <p className="mt-2 text-sm whitespace-pre-line">{review.comment}</p> : null}
                {review.reply ? (
                  <div className="mt-3 rounded-2xl bg-nh-lime-soft px-4 py-3 text-sm">
                    <p className="flex items-center gap-1.5 text-[11px] font-extrabold tracking-[0.12em] text-nh-forest uppercase">
                      <MessageCircle size={13} /> {t("Reply from the outlet")}
                    </p>
                    <p className="mt-1 whitespace-pre-line text-nh-ink">{review.reply}</p>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {rating ? (
        <RateSheet
          order={rating}
          onClose={() => setRating(null)}
          onDone={() => {
            setRating(null);
            setThanks(true);
          }}
        />
      ) : null}
    </div>
  );
}

function RateSheet({ order, onClose, onDone }: { order: ReviewableOrder; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const refresh = useRefresh();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await submitReview(order.id, stars, comment.trim() || null);
      await refresh(loyaltyKeys.reviews);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Request failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet kicker={order.order_number} title={t("How was your order?")} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2">
          <div className="flex gap-2" role="radiogroup" aria-label={t("Rating")}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={stars === n}
                aria-label={t("{n} stars", { n })}
                onClick={() => setStars(n)}
                className="rounded-full p-1 active:scale-95"
              >
                <Star size={36} className={n <= stars ? "fill-nh-forest text-nh-forest" : "text-nh-ink/20"} />
              </button>
            ))}
          </div>
          <p className="h-5 text-sm font-bold text-nh-muted">{stars ? t(RATING_HINTS[stars]) : t("Tap a star")}</p>
        </div>
        <label>
          <span className="nh-label">{t("Comment (optional)")}</span>
          <textarea
            value={comment}
            maxLength={COMMENT_MAX}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("Tell us about the taste, service, or vibe")}
            className="nh-input min-h-24"
          />
        </label>
        {error ? <Notice ok={false}>{error}</Notice> : null}
        <button
          type="button"
          className="nh-btn-brand w-full"
          disabled={stars === 0 || busy}
          onClick={() => void submit()}
        >
          {busy ? t("Sending…") : t("Send review")}
        </button>
      </div>
    </BottomSheet>
  );
}
