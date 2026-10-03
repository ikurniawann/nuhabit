"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, Coins, MapPin, User } from "lucide-react";
import { hariJam } from "../../format";
import { MEMBER_KEYS, memberApi, postJson } from "../mobile-api";
import { useLocale, useT } from "../mobile-i18n";
import { BottomSheet } from "../mobile-sheets";
import { ErrorNote, LoadingNote } from "../mobile-ui";
import { GYM_MEMBER_KEYS, jamWib, useGymClass, type GymClass, type MyBooking } from "./gym-classes-api";

/** Label status booking member di kartu kelas, atau sisa kursi. */
function statusChip(t: ReturnType<typeof useT>, booking: MyBooking | null, seatsLeft: number) {
  if (booking?.status === "confirmed") return { label: t("Terdaftar"), className: "bg-nh-lime text-nh-ink" };
  if (booking?.status === "checked_in") return { label: t("Check-in"), className: "bg-nh-forest text-white" };
  if (booking?.status === "waitlist")
    return booking.promotion_offered_at
      ? { label: t("Kursi ditawarkan"), className: "bg-nh-lime text-nh-ink" }
      : { label: t("Waitlist #{n}", { n: booking.waitlist_position ?? "" }), className: "bg-nh-raised text-nh-ink" };
  if (seatsLeft <= 0) return { label: t("Penuh · waitlist"), className: "bg-nh-raised text-nh-muted" };
  return null;
}

/** Kartu satu kelas: jam, nama, coach, kursi tersisa, biaya kredit, status booking. */
export function ClassCard({ session, onOpen }: { session: Omit<GymClass, "cancel_info">; onOpen: () => void }) {
  const t = useT();
  const locale = useLocale();
  const chip = statusChip(t, session.my_booking, session.seats_left);
  return (
    <button type="button" onClick={onOpen} className="nh-card block w-full text-left active:scale-[0.99]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-[0.18em] text-nh-muted uppercase">
            {jamWib(session.starts_at, locale)}–{jamWib(session.ends_at, locale)}
          </p>
          <p className="nh-display mt-1 text-xl leading-tight">{session.class_type_name}</p>
        </div>
        {chip && <span className={`nh-chip shrink-0 ${chip.className}`}>{chip.label}</span>}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-nh-muted">
        {session.coach_name && (
          <span className="inline-flex items-center gap-1">
            <User size={13} /> {session.coach_name}
          </span>
        )}
        {session.area && (
          <span className="inline-flex items-center gap-1">
            <MapPin size={13} /> {session.area}
          </span>
        )}
        <span>{session.seats_left > 0 ? t("{n} kursi tersisa", { n: session.seats_left }) : t("Penuh")}</span>
        <span className="font-bold text-nh-ink">{t("{n} kredit", { n: session.credit_cost })}</span>
      </div>
    </button>
  );
}

/**
 * Lembar detail kelas: booking, batal (dengan peringatan batal terlambat),
 * terima kursi tawaran waitlist. Kredit dipotong saat check-in, bukan di sini.
 */
export function ClassSheet({
  sessionId,
  onClose,
  onBuyCredits,
}: {
  sessionId: string;
  onClose: () => void;
  onBuyCredits?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const detail = useGymClass(sessionId);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: GYM_MEMBER_KEYS.all });
    void queryClient.invalidateQueries({ queryKey: MEMBER_KEYS.notifications });
  };
  const onError = (error: Error) => setMessage({ tone: "error", text: error.message });

  const book = useMutation({
    mutationFn: () =>
      postJson<{ status: "confirmed" | "waitlist"; waitlistPosition: number | null }>("/api/member-portal/gym/bookings", {
        session_id: sessionId,
      }),
    onSuccess: (data) => {
      setMessage({
        tone: "ok",
        text:
          data.status === "confirmed"
            ? t("Anda terdaftar. Kredit dipotong saat check-in.")
            : t("Kelas penuh. Anda di waitlist #{n}.", { n: data.waitlistPosition ?? "" }),
      });
      refresh();
    },
    onError,
  });
  const cancel = useMutation({
    mutationFn: (bookingId: string) =>
      memberApi<{ late: boolean; penalty_credits: number }>(`/api/member-portal/gym/bookings/${bookingId}`, {
        method: "DELETE",
      }),
    onSuccess: (data) => {
      setConfirmCancel(false);
      setMessage({
        tone: "ok",
        text: data.penalty_credits
          ? t("Booking dibatalkan. {n} kredit hangus karena batal terlambat.", { n: data.penalty_credits })
          : t("Booking dibatalkan."),
      });
      refresh();
    },
    onError,
  });
  const accept = useMutation({
    mutationFn: (bookingId: string) => postJson(`/api/member-portal/gym/bookings/${bookingId}`, { action: "confirm_offer" }),
    onSuccess: () => {
      setMessage({ tone: "ok", text: t("Kursi Anda sudah terkonfirmasi.") });
      refresh();
    },
    onError,
  });

  const session = detail.data;
  const busy = book.isPending || cancel.isPending || accept.isPending;
  const booking = session?.my_booking ?? null;
  const info = session?.cancel_info ?? null;

  return (
    <BottomSheet
      kicker={session ? hariJam(session.starts_at, locale) : undefined}
      title={session?.class_type_name ?? t("Kelas")}
      onClose={onClose}
    >
      {detail.isLoading && <LoadingNote />}
      {detail.error && <ErrorNote>{detail.error.message}</ErrorNote>}
      {session && (
        <>
          <div className="nh-card flex flex-col gap-2.5 text-sm">
            <Detail icon={<Clock size={15} />}>
              {hariJam(session.starts_at, locale)} – {jamWib(session.ends_at, locale)}
            </Detail>
            {session.coach_name && (
              <Detail icon={<User size={15} />}>
                {t("Bersama {name}", { name: session.coach_name })}
                {session.coach_specialization && <span className="text-nh-muted"> · {session.coach_specialization}</span>}
              </Detail>
            )}
            {session.area && <Detail icon={<MapPin size={15} />}>{session.area}</Detail>}
            <Detail icon={<Coins size={15} />}>
              {t("{n} kredit, dipotong saat check-in", { n: session.credit_cost })} ·{" "}
              {t("{n} dari {total} kursi terisi", { n: session.confirmed_count, total: session.capacity })}
            </Detail>
          </div>
          {session.description && <p className="mt-4 text-sm whitespace-pre-line text-nh-ink/80">{session.description}</p>}

          {message && (
            <p
              role="status"
              className={`mt-4 rounded-2xl px-4 py-3 text-sm font-semibold ${
                message.tone === "ok" ? "bg-nh-lime-soft text-nh-forest" : "bg-nh-danger/10 text-nh-danger"
              }`}
            >
              {message.text}
            </p>
          )}
          {message?.tone === "error" && /kredit/i.test(message.text) && onBuyCredits && (
            <button type="button" className="nh-btn-ghost mt-3 w-full" onClick={onBuyCredits}>
              {t("Beli kredit")}
            </button>
          )}

          <div className="mt-5 flex flex-col gap-2">
            {!booking && (
              <button type="button" className="nh-btn-brand w-full" disabled={busy} onClick={() => book.mutate()}>
                {busy ? t("Memproses…") : session.seats_left > 0 ? t("Booking kelas") : t("Masuk waitlist")}
              </button>
            )}

            {booking?.status === "waitlist" && booking.promotion_offered_at && (
              <button type="button" className="nh-btn-brand w-full" disabled={busy} onClick={() => accept.mutate(booking.id)}>
                {t("Ambil kursi")}
              </button>
            )}

            {booking?.status === "checked_in" && (
              <p className="rounded-2xl bg-nh-lime-soft px-4 py-3 text-center text-sm font-semibold text-nh-forest">
                {t("Anda sudah check-in. Selamat berlatih!")}
              </p>
            )}

            {(booking?.status === "confirmed" || booking?.status === "waitlist") &&
              (confirmCancel && info?.late ? (
                <div className="rounded-2xl bg-nh-warn/15 p-4 text-sm">
                  <p className="font-semibold">{t("Batas batal gratis sudah lewat")}</p>
                  <p className="mt-1 text-nh-ink/80">
                    {info.penalty_credits
                      ? t("Batal sekarang membuat {n} kredit hangus.", { n: info.penalty_credits })
                      : t("Batal sekarang tercatat sebagai batal terlambat, tanpa potongan kredit.")}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" className="nh-btn-ghost flex-1" onClick={() => setConfirmCancel(false)}>
                      {t("Kembali")}
                    </button>
                    <button
                      type="button"
                      className="nh-btn-ghost flex-1 text-nh-danger"
                      disabled={busy}
                      onClick={() => cancel.mutate(booking.id)}
                    >
                      {t("Tetap batalkan")}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="nh-btn-ghost w-full text-nh-danger"
                    disabled={busy}
                    onClick={() => (info?.late ? setConfirmCancel(true) : cancel.mutate(booking.id))}
                  >
                    {booking.status === "waitlist" ? t("Keluar dari waitlist") : t("Batalkan booking")}
                  </button>
                  {info && !info.late && (
                    <p className="text-center text-xs text-nh-muted">
                      {t("Batal gratis sampai {time}.", { time: hariJam(info.deadline, locale) })}
                    </p>
                  )}
                </>
              ))}
          </div>
        </>
      )}
    </BottomSheet>
  );
}

function Detail({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0 text-nh-muted">{icon}</span>
      <span>{children}</span>
    </p>
  );
}
