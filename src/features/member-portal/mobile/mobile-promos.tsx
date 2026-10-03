"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, TicketPercent } from "lucide-react";
import type { MemberPromo } from "@/lib/member-portal/promos";
import { angka, tanggalPendek } from "../format";
import { MEMBER_KEYS, memberApi } from "./mobile-api";
import { useLocale, useT, type T } from "./mobile-i18n";
import { BottomSheet } from "./mobile-sheets";
import { EmptyCard, ErrorNote, LoadingNote, ScreenTitle, SectionHeader, SeeAll } from "./mobile-ui";

const useMemberPromos = () =>
  useQuery({ queryKey: MEMBER_KEYS.promos, queryFn: () => memberApi<MemberPromo[]>("/api/member-portal/promos") });

function promoLabel(t: T, promo: MemberPromo): string {
  return promo.discount_type === "percent"
    ? t("Diskon {n}%", { n: angka(promo.value) })
    : t("Potongan Rp {n}", { n: angka(promo.value) });
}

const SCOPE_LABELS: Record<MemberPromo["scope"], string> = {
  pos: "Di kasir",
  semua: "Kasir & tiket",
  ticketing_online: "Tiket online",
  ticketing_loket: "Tiket di loket",
};

function PromoCard({ promo, onOpen, compact }: { promo: MemberPromo; onOpen: () => void; compact?: boolean }) {
  const t = useT();
  const locale = useLocale();
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`nh-card nh-surface-ink relative block overflow-hidden !border-0 text-left text-white active:scale-[0.99] ${
        compact ? "w-64 shrink-0 snap-start" : "w-full"
      }`}
    >
      <div className="pointer-events-none absolute -top-16 -right-12 size-40 rounded-full bg-nh-lime/20 blur-3xl" />
      <p className="relative text-[10px] font-bold tracking-[0.22em] text-white/50 uppercase">
        {promo.valid_until
          ? t("Sampai {date}", { date: tanggalPendek(promo.valid_until, locale) })
          : t("Tanpa batas waktu")}
      </p>
      <p className="nh-display relative mt-1 text-3xl leading-none text-nh-lime">{promoLabel(t, promo)}</p>
      <p className="relative mt-2 truncate text-sm font-bold">{promo.name}</p>
      <span className="relative mt-3 inline-flex rounded-full bg-white/10 px-3 py-1 font-mono text-xs font-bold tracking-[0.14em]">
        {promo.code}
      </span>
      {promo.used_up && (
        <span className="nh-chip absolute top-4 right-4 bg-white/15 text-white/80">{t("Sudah dipakai")}</span>
      )}
    </button>
  );
}

/** Rel horizontal promo di beranda; tersembunyi bila tidak ada promo. */
export function PromoRail({ onOpen, onSeeAll }: { onOpen: (code: string) => void; onSeeAll: () => void }) {
  const t = useT();
  const { data } = useMemberPromos();
  if (!data?.length) return null;
  return (
    <section>
      <SectionHeader label={t("Promo")} action={<SeeAll onClick={onSeeAll} />} />
      <div className="-mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
        {data.map((promo) => (
          <PromoCard key={promo.code} promo={promo} compact onOpen={() => onOpen(promo.code)} />
        ))}
      </div>
    </section>
  );
}

export function PromosScreen({ onOpen }: { onOpen: (code: string) => void }) {
  const t = useT();
  const { data, isLoading, error } = useMemberPromos();
  return (
    <div className="flex flex-col gap-5">
      <ScreenTitle hint={t("Salin kode lalu sebutkan atau masukkan saat bayar.")}>{t("Promo")}</ScreenTitle>
      {isLoading && <LoadingNote />}
      {error && <ErrorNote>{error.message}</ErrorNote>}
      {data && data.length === 0 && <EmptyCard>{t("Belum ada promo untuk member saat ini.")}</EmptyCard>}
      {data?.map((promo) => <PromoCard key={promo.code} promo={promo} onOpen={() => onOpen(promo.code)} />)}
    </div>
  );
}

/** Detail promo + syarat + tombol salin kode. */
export function PromoSheet({ code, onClose }: { code: string; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const { data, isLoading } = useMemberPromos();
  const [copied, setCopied] = useState(false);
  const promo = data?.find((p) => p.code.toUpperCase() === code.toUpperCase()) ?? null;

  const copy = async () => {
    if (!promo) return;
    try {
      await navigator.clipboard.writeText(promo.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  };

  const terms: Array<[string, string]> = promo
    ? [
        [
          t("Berlaku"),
          promo.valid_from || promo.valid_until
            ? `${promo.valid_from ? tanggalPendek(promo.valid_from, locale) : "…"} – ${
                promo.valid_until ? tanggalPendek(promo.valid_until, locale) : "…"
              }`
            : t("Tanpa batas waktu"),
        ],
        [t("Minimal belanja"), promo.min_purchase > 0 ? `Rp ${angka(promo.min_purchase)}` : t("Tanpa minimum")],
        ...(promo.max_discount ? [[t("Maksimal potongan"), `Rp ${angka(promo.max_discount)}`] as [string, string]] : []),
        [t("Dipakai di"), t(SCOPE_LABELS[promo.scope])],
        [
          t("Per member"),
          promo.per_member_limit ? t("{n} kali", { n: promo.per_member_limit }) : t("Tanpa batas"),
        ],
      ]
    : [];

  return (
    <BottomSheet kicker={t("Promo")} title={promo?.name ?? code} onClose={onClose}>
      {isLoading && <LoadingNote />}
      {!isLoading && !promo && <EmptyCard>{t("Promo ini sudah tidak tersedia.")}</EmptyCard>}
      {promo && (
        <>
          <div className="nh-card nh-surface-ink relative overflow-hidden !border-0 !p-6 text-white">
            <div className="pointer-events-none absolute -top-20 -right-16 size-56 rounded-full bg-nh-lime/20 blur-3xl" />
            <TicketPercent size={22} className="relative text-nh-lime" />
            <p className="nh-display relative mt-2 text-5xl leading-none">{promoLabel(t, promo)}</p>
            <button
              type="button"
              onClick={() => void copy()}
              className="relative mt-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 font-mono text-sm font-bold tracking-[0.14em] active:scale-95"
              aria-label={t("Salin kode {code}", { code: promo.code })}
            >
              {promo.code}
              {copied ? <Check size={15} className="text-nh-lime" /> : <Copy size={14} className="text-white/60" />}
            </button>
            <p role="status" className="relative mt-2 h-4 text-xs font-semibold text-nh-lime">
              {copied ? t("Kode tersalin") : ""}
            </p>
          </div>
          {promo.description && (
            <p className="mt-4 text-sm whitespace-pre-line text-nh-ink/80">{promo.description}</p>
          )}
          <div className="nh-card mt-4 flex flex-col gap-3 text-sm">
            {terms.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <span className="text-nh-muted">{label}</span>
                <span className="text-right font-bold">{value}</span>
              </div>
            ))}
          </div>
          {promo.used_up && (
            <p className="mt-3 rounded-2xl bg-nh-raised px-4 py-3 text-sm text-nh-muted">
              {t("Anda sudah memakai jatah promo ini.")}
            </p>
          )}
          <button type="button" onClick={() => void copy()} className="nh-btn-brand mt-5 w-full">
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? t("Kode tersalin") : t("Salin kode")}
          </button>
        </>
      )}
    </BottomSheet>
  );
}
