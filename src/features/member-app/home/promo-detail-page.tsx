"use client";

import { ArrowLeft, Copy } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { usePromos, type PromoView } from "../lib/queries-home";
import { EmptyState, Spinner, formatDay } from "../ui";

const SCOPE_LABEL: Record<PromoView["scope"], string> = {
  semua: "All purchases",
  pos: "In-store purchases",
  ticketing_online: "Online tickets",
  ticketing_loket: "Box office tickets",
};

export function PromoDetailPage() {
  const t = useT();
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(params.code ?? "");
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const { data: promos, isLoading } = usePromos();

  const back = (
    <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-bold text-nh-muted">
      <ArrowLeft size={16} /> {t("Back")}
    </button>
  );

  if (isLoading) return <Spinner label={t("Loading promo…")} />;
  const p = promos?.find((x) => x.code.toUpperCase() === code.toUpperCase());
  if (!p) {
    return (
      <div className="flex flex-col gap-5">
        {back}
        <EmptyState title={t("Promo not found")} hint={t("This promo has ended or is not available to you.")} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {back}

      <div className="nh-card nh-surface-ink relative overflow-hidden !border-0 !p-7 text-white">
        <div className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-nh-lime/20 blur-3xl" />
        <div className="relative">
          <p className="text-[10px] font-bold tracking-[0.22em] text-white/50 uppercase">
            {p.live ? t("Live promo") : t("Promo")}
          </p>
          <p className="nh-display mt-1 text-5xl leading-none">{p.label}</p>
          <button
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 font-mono text-sm font-bold tracking-[0.14em]"
            onClick={() => {
              void navigator.clipboard?.writeText(p.code);
              setCopied(true);
            }}
          >
            {p.code} <Copy size={14} className="text-white/60" />
            {copied ? <span className="text-[10px] text-nh-ok uppercase">{t("Copied")}</span> : null}
          </button>
        </div>
      </div>

      <div className="nh-card flex flex-col gap-3 text-sm">
        <div className="flex justify-between">
          <span className="text-nh-muted">{t("Valid")}</span>
          <span className="font-bold">
            {p.startsAt ? formatDay(p.startsAt) : "-"} – {p.endsAt ? formatDay(p.endsAt) : t("No end date")}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-nh-muted">{t("Applies to")}</span>
          <span className="max-w-[60%] text-right font-bold">{t(SCOPE_LABEL[p.scope])}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-nh-muted">{t("Per member")}</span>
          <span className="font-bold">
            {p.perMemberLimit === null
              ? t("Unlimited")
              : t(p.perMemberLimit === 1 ? "{n} use" : "{n} uses", { n: p.perMemberLimit })}
          </span>
        </div>
      </div>

      <Link
        href={`${m("/wallet/topup")}?voucher=${encodeURIComponent(p.code)}`}
        className={`nh-btn-brand ${p.live ? "" : "pointer-events-none opacity-40"}`}
      >
        {t("Use it at top up")}
      </Link>
    </div>
  );
}
