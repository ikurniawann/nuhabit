"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { ArrowRight, Bell, CalendarDays, ChevronRight, Clock, MapPin, Megaphone, Trophy, User } from "lucide-react";
import { parsePortalLink } from "@/lib/member-portal/links";
import { angka, hariJam, tanggalPendek } from "../format";
import { MEMBER_KEYS, memberApi, postJson } from "./mobile-api";
import { useLocale, useT, type T } from "./mobile-i18n";
import { trackNotification } from "./mobile-notification-tracking";
import { BottomSheet } from "./mobile-sheets";
import { EmptyCard, ErrorNote, LoadingNote, SectionHeader, SeeAll } from "./mobile-ui";

/* ── Data ────────────────────────────────────────────────────────────── */

export interface MemberNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  image_url: string | null;
  link_url: string | null;
  created_at: string;
  read_at: string | null;
}

export interface MemberEvent {
  id: string;
  title: string;
  description: string;
  host_name: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  price_idr: number;
  cancel_deadline_hours: number;
  confirmed_count: number;
  booking_id: string | null;
  booking_status: "confirmed" | "waitlist" | "attended" | "no_show" | null;
  waitlist_position: number | null;
}

export interface MemberChallenge {
  id: string;
  title: string;
  description: string;
  metric: "visits" | "spend";
  target: number;
  starts_at: string;
  ends_at: string;
  reward_xp: number;
  reward_ark_idr: number;
  phase: "upcoming" | "running" | "ended";
  joined: boolean;
  rewarded_at: string | null;
  participant_count: number;
  progress: { value: number; target: number; pct: number; completed: boolean } | null;
  my_rank: number | null;
  leaderboard: Array<{ rank: number; name: string; value: number; is_me: boolean }>;
}

export const useMemberNotifications = () =>
  useQuery({
    queryKey: MEMBER_KEYS.notifications,
    queryFn: () => memberApi<{ notifications: MemberNotification[]; unread: number }>("/api/member-portal/notifications"),
    refetchInterval: 60_000,
  });

export const useMemberEvents = () =>
  useQuery({ queryKey: MEMBER_KEYS.events, queryFn: () => memberApi<MemberEvent[]>("/api/member-portal/events") });

export const useMemberChallenges = () =>
  useQuery({
    queryKey: MEMBER_KEYS.challenges,
    queryFn: () => memberApi<MemberChallenge[]>("/api/member-portal/challenges"),
  });

/* ── Format ──────────────────────────────────────────────────────────── */

const metricValue = (t: T, c: Pick<MemberChallenge, "metric">, value: number) =>
  c.metric === "spend" ? `Rp ${angka(value)}` : t("{n} kunjungan", { n: angka(value) });

function rewardText(t: T, c: Pick<MemberChallenge, "reward_xp" | "reward_ark_idr">) {
  return [
    c.reward_xp > 0 && `${angka(c.reward_xp)} XP`,
    c.reward_ark_idr > 0 && t("ARK senilai Rp {n}", { n: angka(c.reward_ark_idr) }),
  ]
    .filter(Boolean)
    .join(" + ");
}

/* ── QR kartu member ─────────────────────────────────────────────────── */

/**
 * QR sekali pakai yang diperbarui sebelum kedaluwarsa. Tangkapan layar tidak
 * berguna: kasir menolak QR yang sudah lewat 60 detik atau sudah dipindai.
 */
export function MemberQr() {
  const t = useT();
  const qr = useQuery({
    queryKey: ["member-portal", "qr"],
    queryFn: () => postJson<{ token: string; expires_at: string }>("/api/member-portal/qr", {}),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data ? Math.max(1_000, new Date(data.expires_at).getTime() - Date.now() - 5_000) : false;
    },
    gcTime: 0,
    staleTime: 0,
  });
  const [secondsLeft, setSecondsLeft] = useState(0);
  useEffect(() => {
    if (!qr.data) return;
    const tick = () =>
      setSecondsLeft(Math.max(0, Math.ceil((new Date(qr.data.expires_at).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [qr.data]);

  return (
    <div className="flex flex-col items-center">
      <div className="rounded-2xl bg-white p-3.5">
        {qr.data ? (
          <QRCodeSVG value={qr.data.token} size={168} level="M" marginSize={0} />
        ) : (
          <div className="flex size-[168px] items-center justify-center text-center text-xs text-nh-muted">
            {qr.error ? t("QR belum bisa dimuat") : t("Menyiapkan QR…")}
          </div>
        )}
      </div>
      <p className="mt-2 text-center text-[11px] font-bold text-white/45">
        {qr.data ? t("Pindai di kasir · diperbarui dalam {n} dtk", { n: secondsLeft }) : " "}
      </p>
    </div>
  );
}

/* ── Notifikasi ──────────────────────────────────────────────────────── */

export function NotificationsSheet({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  /** Buka tujuan portal ("events", "promo:KODE") dari tombol notifikasi. */
  onNavigate: (link: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useMemberNotifications();
  const [openId, setOpenId] = useState<string | null>(null);
  const markAll = useMutation({
    mutationFn: () => postJson("/api/member-portal/notifications", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MEMBER_KEYS.notifications }),
  });
  const unread = data?.unread ?? 0;
  const open = data?.notifications.find((n) => n.id === openId) ?? null;

  // Titik "baru" tetap terlihat selama lembar terbuka; ditandai dibaca saat ditutup.
  const close = () => {
    if (unread > 0) markAll.mutate();
    onClose();
  };
  const tap = (n: MemberNotification, hasDetail: boolean) => {
    trackNotification(n.id, "open");
    if (hasDetail) setOpenId(n.id);
  };
  const navigate = (id: string, link: string) => {
    trackNotification(id, "click");
    if (unread > 0) markAll.mutate();
    onNavigate(link);
  };

  return (
    <>
      <BottomSheet
        kicker={unread ? t("{n} baru", { n: unread }) : t("Semua sudah dibaca")}
        title={t("Notifikasi")}
        onClose={close}
      >
        {isLoading && <LoadingNote />}
        {error && <ErrorNote>{error.message}</ErrorNote>}
        {data && data.notifications.length === 0 && (
          <EmptyCard>{t("Belum ada notifikasi. Kabar event, challenge, dan promo akan muncul di sini.")}</EmptyCard>
        )}
        {data && data.notifications.length > 0 && (
          <div className="nh-card divide-y divide-nh-line !py-1">
            {data.notifications.map((n) => {
              const hasDetail = Boolean(n.image_url || parsePortalLink(n.link_url));
              const body = (
                <>
                  <span
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read_at ? "bg-nh-ink/20" : "bg-nh-forest"}`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-extrabold">{n.title}</span>
                      <span className="shrink-0 text-xs text-nh-muted/70">{tanggalPendek(n.created_at, locale)}</span>
                    </span>
                    {n.body && <span className="mt-0.5 line-clamp-2 block text-sm text-nh-muted">{n.body}</span>}
                  </span>
                  {hasDetail && <ChevronRight size={16} className="mt-1 shrink-0 text-nh-muted" />}
                </>
              );
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => tap(n, hasDetail)}
                  className="flex w-full gap-3 py-3.5 text-left"
                >
                  {body}
                </button>
              );
            })}
          </div>
        )}
      </BottomSheet>
      {open && (
        <NotificationDetailSheet
          notification={open}
          onClose={() => setOpenId(null)}
          onNavigate={(link) => navigate(open.id, link)}
        />
      )}
    </>
  );
}

/** Detail pengumuman: gambar penuh + tombol ke halaman portal tujuan. */
function NotificationDetailSheet({
  notification: n,
  onClose,
  onNavigate,
}: {
  notification: MemberNotification;
  onClose: () => void;
  onNavigate: (link: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const link = parsePortalLink(n.link_url) ? n.link_url : null;
  return (
    <BottomSheet
      kicker={`${n.type === "promo" ? t("Promo") : t("Pengumuman")} · ${tanggalPendek(n.created_at, locale)}`}
      title={n.title}
      onClose={onClose}
    >
      {n.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- gambar unggahan admin (/api/files), ukuran bebas
        <img src={n.image_url} alt="" className="mb-4 max-h-72 w-full rounded-3xl object-cover" />
      ) : (
        <div className="nh-surface-ink mb-4 flex h-24 items-center justify-center rounded-3xl">
          <Megaphone size={26} className="text-nh-lime" />
        </div>
      )}
      {n.body && <p className="text-[15px] leading-relaxed whitespace-pre-line text-nh-ink/80">{n.body}</p>}
      {link && (
        <button type="button" className="nh-btn-brand mt-5 w-full" onClick={() => onNavigate(link)}>
          {t("Buka di portal")} <ArrowRight size={16} />
        </button>
      )}
    </BottomSheet>
  );
}

export function BellButton({ className, onClick }: { className: string; onClick: () => void }) {
  const t = useT();
  const unread = useMemberNotifications().data?.unread ?? 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={unread ? t("Notifikasi, {n} belum dibaca", { n: unread }) : t("Notifikasi")}
      className={`relative ${className}`}
    >
      <Bell size={17} strokeWidth={2.4} />
      {unread > 0 && (
        <span className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-nh-forest px-1 text-[10px] font-black text-white ring-2 ring-nh-beige">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}

/* ── Event ───────────────────────────────────────────────────────────── */

function bookingChip(t: T, event: MemberEvent): { label: string; className: string } | null {
  if (event.booking_status === "confirmed") return { label: t("Terdaftar"), className: "bg-nh-lime text-nh-ink" };
  if (event.booking_status === "waitlist")
    return { label: t("Waitlist #{n}", { n: event.waitlist_position ?? "" }), className: "bg-nh-raised text-nh-ink" };
  if (event.confirmed_count >= event.capacity)
    return { label: t("Penuh · waitlist"), className: "bg-nh-raised text-nh-muted" };
  return null;
}

function EventCard({ event, onOpen }: { event: MemberEvent; onOpen: () => void }) {
  const t = useT();
  const locale = useLocale();
  const chip = bookingChip(t, event);
  const seatsLeft = Math.max(0, event.capacity - event.confirmed_count);
  return (
    <button type="button" onClick={onOpen} className="nh-card block w-full text-left active:scale-[0.99]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-[0.18em] text-nh-muted uppercase">
            {hariJam(event.starts_at, locale)}
          </p>
          <p className="nh-display mt-1 text-xl leading-tight">{event.title}</p>
        </div>
        {chip && <span className={`nh-chip shrink-0 ${chip.className}`}>{chip.label}</span>}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-nh-muted">
        {event.location && (
          <span className="inline-flex items-center gap-1">
            <MapPin size={13} /> {event.location}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <User size={13} /> {seatsLeft > 0 ? t("{n} kursi tersisa", { n: seatsLeft }) : t("Penuh")}
        </span>
        <span className="font-bold text-nh-ink">
          {event.price_idr > 0 ? `Rp ${angka(event.price_idr)}` : t("Gratis")}
        </span>
      </div>
    </button>
  );
}

export function EventsScreen() {
  const t = useT();
  const { data, isLoading, error } = useMemberEvents();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = data?.find((e) => e.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="nh-display text-3xl font-black">{t("Event & kelas")}</h1>
      <p className="-mt-3 text-sm text-nh-muted">
        {t("Race day, workshop, dan acara komunitas. Daftar sekali tap.")}
      </p>
      {isLoading && <LoadingNote>{t("Memuat event…")}</LoadingNote>}
      {error && <ErrorNote>{error.message}</ErrorNote>}
      {data && data.length === 0 && (
        <EmptyCard>{t("Belum ada event terjadwal. Kami kabari lewat notifikasi saat ada yang baru.")}</EmptyCard>
      )}
      {data?.map((event) => <EventCard key={event.id} event={event} onOpen={() => setOpenId(event.id)} />)}
      {open && <EventSheet event={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

export function UpcomingEvents({ onSeeAll }: { onSeeAll: () => void }) {
  const t = useT();
  const { data } = useMemberEvents();
  const [openId, setOpenId] = useState<string | null>(null);
  const events = (data ?? []).slice(0, 2);
  const open = data?.find((e) => e.id === openId) ?? null;
  if (events.length === 0) return null;
  return (
    <section>
      <SectionHeader label={t("Event mendatang")} action={<SeeAll onClick={onSeeAll} />} />
      <div className="flex flex-col gap-3">
        {events.map((event) => (
          <EventCard key={event.id} event={event} onOpen={() => setOpenId(event.id)} />
        ))}
      </div>
      {open && <EventSheet event={open} onClose={() => setOpenId(null)} />}
    </section>
  );
}

function EventSheet({ event, onClose }: { event: MemberEvent; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: MEMBER_KEYS.events });
    void queryClient.invalidateQueries({ queryKey: MEMBER_KEYS.notifications });
  };
  const book = useMutation({
    mutationFn: () =>
      postJson<{ kind: "confirm" | "waitlist"; position?: number }>("/api/member-portal/events", {
        event_id: event.id,
      }),
    onSuccess: (data) => {
      setMessage({
        tone: "ok",
        text:
          data.kind === "confirm"
            ? t("Anda terdaftar. Sampai jumpa!")
            : t("Event penuh. Anda di waitlist #{n}.", { n: data.position ?? "" }),
      });
      refresh();
    },
    onError: (error) => setMessage({ tone: "error", text: error.message }),
  });
  const cancel = useMutation({
    mutationFn: () => memberApi(`/api/member-portal/events?booking_id=${event.booking_id}`, { method: "DELETE" }),
    onSuccess: () => {
      setMessage({ tone: "ok", text: t("Pendaftaran dibatalkan.") });
      refresh();
    },
    onError: (error) => setMessage({ tone: "error", text: error.message }),
  });
  const busy = book.isPending || cancel.isPending;
  const full = event.confirmed_count >= event.capacity;
  const active = event.booking_status === "confirmed" || event.booking_status === "waitlist";
  const endTime = new Date(event.ends_at).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });

  return (
    <BottomSheet kicker={hariJam(event.starts_at, locale)} title={event.title} onClose={onClose}>
      <div className="nh-card flex flex-col gap-2.5 text-sm">
        <Detail icon={<Clock size={15} />}>
          {hariJam(event.starts_at, locale)} – {endTime}
        </Detail>
        {event.location && <Detail icon={<MapPin size={15} />}>{event.location}</Detail>}
        {event.host_name && <Detail icon={<User size={15} />}>{t("Bersama {name}", { name: event.host_name })}</Detail>}
        <Detail icon={<CalendarDays size={15} />}>
          {t("{n} dari {total} kursi terisi", { n: angka(event.confirmed_count), total: angka(event.capacity) })} ·{" "}
          {event.price_idr > 0 ? t("Rp {n}, bayar di outlet", { n: angka(event.price_idr) }) : t("Gratis")}
        </Detail>
      </div>
      {event.description && <p className="mt-4 text-sm whitespace-pre-line text-nh-ink/80">{event.description}</p>}
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
      <div className="mt-5">
        {active ? (
          <>
            <button
              type="button"
              className="nh-btn-ghost w-full text-nh-danger"
              disabled={busy}
              onClick={() => cancel.mutate()}
            >
              {event.booking_status === "waitlist" ? t("Keluar dari waitlist") : t("Batalkan pendaftaran")}
            </button>
            {event.booking_status === "confirmed" && event.cancel_deadline_hours > 0 && (
              <p className="mt-2 text-center text-xs text-nh-muted">
                {t("Batal kurang dari {n} jam sebelum mulai dicatat sebagai batal terlambat.", {
                  n: event.cancel_deadline_hours,
                })}
              </p>
            )}
          </>
        ) : event.booking_status === null ? (
          <button type="button" className="nh-btn-brand w-full" disabled={busy} onClick={() => book.mutate()}>
            {busy ? t("Memproses…") : full ? t("Masuk waitlist") : t("Daftar")}
          </button>
        ) : null}
      </div>
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

/* ── Challenge ───────────────────────────────────────────────────────── */

export function ProgressBar({ pct, label }: { pct: number; label?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
      className="h-2.5 overflow-hidden rounded-full bg-nh-raised"
    >
      <span className="nh-surface-brand block h-full rounded-full" style={{ width: `${pct}%` }} />
    </div>
  );
}

function ChallengeCard({ challenge, onOpen }: { challenge: MemberChallenge; onOpen: () => void }) {
  const t = useT();
  const locale = useLocale();
  const p = challenge.progress;
  const reward = rewardText(t, challenge);
  return (
    <button type="button" onClick={onOpen} className="nh-card block w-full text-left active:scale-[0.99]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-[0.18em] text-nh-muted uppercase">
            {challenge.phase === "upcoming"
              ? t("Mulai {date}", { date: tanggalPendek(challenge.starts_at, locale) })
              : t("Sampai {date}", { date: tanggalPendek(challenge.ends_at, locale) })}
          </p>
          <p className="nh-display mt-1 text-xl leading-tight">{challenge.title}</p>
        </div>
        {challenge.rewarded_at ? (
          <span className="nh-chip shrink-0 bg-nh-lime text-nh-ink">{t("Tuntas")}</span>
        ) : challenge.joined ? (
          <span className="nh-chip shrink-0 bg-nh-forest/10 text-nh-forest">{t("Diikuti")}</span>
        ) : null}
      </div>
      {p ? (
        <div className="mt-3">
          <ProgressBar pct={p.pct} />
          <p className="mt-2 text-xs text-nh-muted">
            {t("{value} dari {target}", {
              value: metricValue(t, challenge, p.value),
              target: metricValue(t, challenge, challenge.target),
            })}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-nh-muted">
          {t("Target {target}", { target: metricValue(t, challenge, challenge.target) })}
          {reward && ` · ${t("hadiah {reward}", { reward })}`}
        </p>
      )}
    </button>
  );
}

export function ChallengesScreen() {
  const t = useT();
  const { data, isLoading, error } = useMemberChallenges();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = data?.find((c) => c.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="nh-display text-3xl font-black">{t("Challenge")}</h1>
      <p className="-mt-3 text-sm text-nh-muted">
        {t("Capai target dalam periode challenge dan hadiahnya masuk otomatis.")}
      </p>
      {isLoading && <LoadingNote>{t("Memuat challenge…")}</LoadingNote>}
      {error && <ErrorNote>{error.message}</ErrorNote>}
      {data && data.length === 0 && <EmptyCard>{t("Belum ada challenge berjalan. Nantikan yang berikutnya.")}</EmptyCard>}
      {data?.map((c) => <ChallengeCard key={c.id} challenge={c} onOpen={() => setOpenId(c.id)} />)}
      {open && <ChallengeSheet challenge={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

export function ChallengeHighlights({ onSeeAll }: { onSeeAll: () => void }) {
  const t = useT();
  const { data } = useMemberChallenges();
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = (data ?? []).filter((c) => c.phase !== "ended").slice(0, 2);
  const open = data?.find((c) => c.id === openId) ?? null;
  if (shown.length === 0) return null;
  return (
    <section>
      <SectionHeader label={t("Challenge")} action={<SeeAll onClick={onSeeAll} />} />
      <div className="flex flex-col gap-3">
        {shown.map((c) => (
          <ChallengeCard key={c.id} challenge={c} onOpen={() => setOpenId(c.id)} />
        ))}
      </div>
      {open && <ChallengeSheet challenge={open} onClose={() => setOpenId(null)} />}
    </section>
  );
}

function ChallengeSheet({ challenge, onClose }: { challenge: MemberChallenge; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const join = useMutation({
    mutationFn: () => postJson("/api/member-portal/challenges", { challenge_id: challenge.id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MEMBER_KEYS.challenges }),
  });
  const p = challenge.progress;
  const reward = rewardText(t, challenge);

  return (
    <BottomSheet
      kicker={t("Sampai {date}", { date: tanggalPendek(challenge.ends_at, locale) })}
      title={challenge.title}
      onClose={onClose}
    >
      <div className="nh-card nh-surface-ink relative overflow-hidden !border-0 text-white">
        <div className="pointer-events-none absolute -top-16 -right-12 size-40 rounded-full bg-nh-lime/20 blur-3xl" />
        <p className="relative text-[10px] font-bold tracking-[0.22em] text-white/50 uppercase">{t("Target")}</p>
        <p className="nh-display relative mt-1 text-3xl">{metricValue(t, challenge, challenge.target)}</p>
        {reward && <p className="relative mt-2 text-xs font-semibold text-nh-lime">{t("Hadiah {reward}", { reward })}</p>}
        {p && (
          <div className="relative mt-4">
            <ProgressBar pct={p.pct} />
            <p className="mt-2 text-xs text-white/60">
              {t("{value} tercatat", { value: metricValue(t, challenge, p.value) })}
              {challenge.my_rank
                ? ` · ${t("peringkat #{rank} dari {total}", { rank: challenge.my_rank, total: challenge.participant_count })}`
                : ""}
            </p>
          </div>
        )}
      </div>
      {challenge.description && (
        <p className="mt-4 text-sm whitespace-pre-line text-nh-ink/80">{challenge.description}</p>
      )}

      {challenge.leaderboard.length > 0 && (
        <section className="mt-5">
          <SectionHeader label={t("Papan peringkat")} />
          <div className="nh-card divide-y divide-nh-line !py-1">
            {challenge.leaderboard.map((row) => (
              <div
                key={row.rank}
                className={`flex items-center gap-3 py-2.5 text-sm ${row.is_me ? "font-extrabold" : ""}`}
              >
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                    row.rank === 1 ? "nh-surface-brand text-nh-ink" : "bg-nh-raised"
                  }`}
                >
                  {row.rank === 1 ? <Trophy size={13} /> : row.rank}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {row.name}
                  {row.is_me && ` (${t("Anda")})`}
                </span>
                <span className="shrink-0 tabular-nums">{metricValue(t, challenge, row.value)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {join.error && (
        <div className="mt-4">
          <ErrorNote>{join.error.message}</ErrorNote>
        </div>
      )}
      {!challenge.joined && challenge.phase !== "ended" && (
        <button
          type="button"
          className="nh-btn-brand mt-5 w-full"
          disabled={join.isPending}
          onClick={() => join.mutate()}
        >
          {join.isPending ? t("Memproses…") : t("Ikut challenge")}
        </button>
      )}
    </BottomSheet>
  );
}
