"use client";

import { useEffect, type ReactNode } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { idrToArkDisplay, isArkCoinMethod } from "@/lib/pos/loyalty-settings";
import { angka, tanggal } from "../format";
import type { NoxMemberData } from "../nox/use-nox-member";
import type { MemberOrderDetail, MemberVisits } from "../use-member-details";
import { useLocale, useT } from "./mobile-i18n";
import { EmptyCard, ErrorNote, LoadingNote } from "./mobile-ui";

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/** Lembar bawah: tutup lewat backdrop, tombol ×, atau Escape. */
export function BottomSheet({
  title,
  kicker,
  onClose,
  children,
}: {
  title: string;
  kicker?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  useEscape(onClose);

  return (
    <div
      className="nh-sheet-backdrop fixed inset-0 z-40 flex items-end justify-center bg-black/55 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="nh-sheet-panel max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] bg-nh-cream px-5 pt-3 pb-[max(env(safe-area-inset-bottom),1.5rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-nh-line" aria-hidden />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {kicker && (
              <p className="text-[11px] font-extrabold tracking-[0.16em] text-nh-muted uppercase">{kicker}</p>
            )}
            <h2 className="nh-display text-2xl leading-tight">{title}</h2>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label={t("Tutup")}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-nh-raised text-nh-ink active:scale-95"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <div className="nh-card divide-y divide-nh-line !py-1">{children}</div>;
}

function Row({
  label,
  hint,
  value,
  tone,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value?: ReactNode;
  tone?: "total" | "ok" | "danger";
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-3 text-sm">
      <span className={tone === "total" ? "font-extrabold" : "font-semibold"}>
        {label}
        {hint && <span className="block text-xs font-medium text-nh-muted">{hint}</span>}
      </span>
      <b
        className={`shrink-0 text-right ${
          tone === "ok" ? "text-nh-ok" : tone === "danger" ? "text-nh-danger" : ""
        }`}
      >
        {value}
      </b>
    </div>
  );
}

function SheetStatus({ busy, error }: { busy: boolean; error: string | null }) {
  if (error) return <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>;
  if (busy) return <LoadingNote />;
  return null;
}

/** Kartu member digital: nomor WhatsApp untuk disebut di kasir. */
export function MemberCardSheet({
  member,
  qr,
  onClose,
}: {
  member: NoxMemberData;
  /** QR check-in dinamis (dari modul engagement). */
  qr: ReactNode;
  onClose: () => void;
}) {
  const t = useT();
  useEscape(onClose);

  return (
    <div
      className="nh-sheet-backdrop fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("Kartu member")}
        className="nh-sheet-panel w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="nh-surface-ink relative overflow-hidden rounded-3xl p-6 text-white shadow-[0_30px_80px_rgb(0_0_0/0.5)]">
          <div className="pointer-events-none absolute -top-28 -right-20 size-64 rounded-full bg-nh-lime/25 blur-3xl" />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <Image
                src="/member-assets/brand/wordmark-white.png"
                alt="NüHabit"
                width={1200}
                height={165}
                unoptimized
                className="h-5 w-auto"
              />
              <p className="mt-2 text-[10px] font-bold tracking-[0.24em] text-white/45 uppercase">{t("Kartu member")}</p>
            </div>
            {member.tier && <span className="nh-chip bg-nh-lime text-nh-ink">{member.tier.name}</span>}
          </div>

          <div className="relative mt-6">{qr}</div>
          <p className="relative mt-3 text-center text-xs text-white/55">
            {t("Tanpa pemindai? Sebutkan nomor")}{" "}
            <span className="font-mono font-bold tracking-wider text-white">{member.profile.phone ?? "—"}</span>
          </p>

          <div className="relative mt-6 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="nh-display truncate text-xl leading-tight">{member.profile.name ?? "Member"}</p>
              <p className="mt-0.5 text-[11px] font-semibold text-white/45">
                {member.tier ? t("Diskon member {n}%", { n: member.tier.discountPercent }) : "Member"}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[10px] font-bold tracking-[0.18em] text-white/45 uppercase">ARK Coin</p>
              <p className="nh-display text-2xl leading-none text-nh-lime">{angka(member.coins)}</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          aria-label={t("Tutup")}
          className="mx-auto mt-5 flex size-11 items-center justify-center rounded-full bg-white/15 text-white"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}

export function OrderSheet({
  nomor,
  detail,
  busy,
  error,
  onClose,
}: {
  nomor: string;
  detail: MemberOrderDetail | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  // Samakan dengan struk kasir: transaksi ARK Coin menampilkan "Rp X / N Ark Coin".
  const pakaiArk = detail ? isArkCoinMethod(detail.order.payment_method) : false;
  const harga = (idr: number) =>
    detail && pakaiArk
      ? `Rp ${angka(idr)} / ${angka(idrToArkDisplay(idr, detail.ark_rate))} ARK`
      : `Rp ${angka(idr)}`;

  return (
    <BottomSheet kicker={t("Detail transaksi")} title={nomor} onClose={onClose}>
      <SheetStatus busy={busy} error={error} />
      {detail && (
        <>
          <p className="mb-3 text-sm text-nh-muted">
            {tanggal(detail.order.ordered_at, locale)}
            {detail.order.venue_name ? ` · ${detail.order.venue_name}` : ""}
          </p>
          <Rows>
            {detail.items.map((item, i) => (
              <Row
                key={i}
                label={`${angka(item.quantity)}× ${item.product_name}`}
                hint={`@ Rp ${angka(item.unit_price)}${
                  item.discount_amount > 0 ? ` · ${t("diskon Rp {n}", { n: angka(item.discount_amount) })}` : ""
                }`}
                value={harga(item.total_amount)}
              />
            ))}
            <Row label="Subtotal" value={harga(detail.order.subtotal)} />
            {detail.order.discount_amount > 0 && (
              <Row
                label={`${t("Diskon")}${detail.order.discount_reason ? ` (${detail.order.discount_reason})` : ""}`}
                value={`−Rp ${angka(detail.order.discount_amount)}`}
                tone="danger"
              />
            )}
            <Row label="Total" value={harga(detail.order.total_amount)} tone="total" />
            {pakaiArk && (
              <Row
                label={t("Dibayar ARK")}
                value={`${angka(
                  idrToArkDisplay(detail.order.ark_coins_used || detail.order.total_amount, detail.ark_rate)
                )} ARK`}
              />
            )}
            {detail.xp_earned > 0 && <Row label={t("XP didapat")} value={`+${angka(detail.xp_earned)} XP`} tone="ok" />}
          </Rows>
        </>
      )}
    </BottomSheet>
  );
}

export function TierSheet({ member, onClose }: { member: NoxMemberData; onClose: () => void }) {
  const t = useT();
  return (
    <BottomSheet kicker={t("Tier & XP")} title={member.tier?.name ?? "Tier"} onClose={onClose}>
      <p className="mb-3 text-sm text-nh-muted">
        {t("{n} XP terkumpul.", { n: angka(member.totalXp) })}{" "}
        {member.nextTier
          ? t("{n} XP lagi menuju {tier}.", { n: angka(member.nextTier.xpNeeded), tier: member.nextTier.name })
          : t("Tier tertinggi sudah tercapai.")}
      </p>
      <Rows>
        {member.tiers.map((tier) => {
          const tercapai = member.totalXp >= tier.minLifetimeXp;
          const aktif = tier.code === member.tier?.code;
          return (
            <Row
              key={tier.code}
              label={tier.name}
              hint={`${angka(tier.minLifetimeXp)} XP · ${t("diskon {n}%", { n: tier.discountPercent })}`}
              value={aktif ? t("Saat ini") : tercapai ? t("Tercapai") : ""}
              tone={aktif ? "ok" : undefined}
            />
          );
        })}
      </Rows>
    </BottomSheet>
  );
}

export function VisitsSheet({
  visits,
  busy,
  error,
  onClose,
}: {
  visits: MemberVisits | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <BottomSheet kicker={t("Perjalanan Anda")} title={t("Kunjungan")} onClose={onClose}>
      <SheetStatus busy={busy} error={error} />
      {visits && (
        <>
          <p className="mb-3 text-sm text-nh-muted">{t("{n} kunjungan tercatat.", { n: angka(visits.visit_count) })}</p>
          {visits.venues.length === 0 ? (
            <EmptyCard>{t("Kunjungan pertama Anda akan tercatat di sini.")}</EmptyCard>
          ) : (
            <Rows>
              {visits.venues.map((venue) => (
                <Row
                  key={venue.venue_name}
                  label={venue.venue_name}
                  hint={t("{orders} transaksi · {days} hari", {
                    orders: angka(venue.order_count),
                    days: angka(venue.day_count),
                  })}
                  value={
                    <span className="text-xs font-semibold text-nh-muted">{tanggal(venue.last_visit_at, locale)}</span>
                  }
                />
              ))}
            </Rows>
          )}
        </>
      )}
    </BottomSheet>
  );
}
