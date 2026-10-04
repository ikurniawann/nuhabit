"use client";

import Link from "next/link";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { usePromos } from "../lib/queries-home";
import { EmptyState, Spinner, formatDay } from "../ui";
import { PageTitle } from "./loyalty-ui";

/** Semua promo member; tiap kartu membuka detail promo (salin kode). */
export function PromosPage() {
  const t = useT();
  const { data: promos, isLoading } = usePromos();

  return (
    <div className="flex flex-col gap-5">
      <PageTitle hint={t("Copy a code, then mention it or enter it when you pay.")}>{t("Promos")}</PageTitle>
      {isLoading ? <Spinner label={t("Loading promos…")} /> : null}
      {promos && promos.length === 0 ? <EmptyState title={t("No member promos right now.")} /> : null}
      {promos?.map((p) => (
        <Link
          key={p.code}
          href={m(`/promos/${encodeURIComponent(p.code)}`)}
          className="nh-card nh-surface-ink relative block overflow-hidden !border-0 text-white"
        >
          <div className="pointer-events-none absolute -top-16 -right-12 h-40 w-40 rounded-full bg-nh-lime/15 blur-3xl" />
          <div className="relative flex items-start justify-between gap-2">
            <p className="nh-display text-3xl leading-none">{p.label}</p>
            <span className="rounded-full bg-white/10 px-2.5 py-1 font-mono text-[11px] font-bold tracking-wider text-white/80">
              {p.code}
            </span>
          </div>
          <p className="relative mt-2 text-sm font-medium text-white/60">{p.description}</p>
          <div className="relative mt-4 flex items-center justify-between text-xs">
            <span className="font-semibold text-white/40">
              {p.endsAt ? `${t("Until")} ${formatDay(p.endsAt)}` : t("No end date")}
            </span>
            {p.live ? (
              <span className="nh-chip bg-nh-lime text-nh-ink">{t("Use it")}</span>
            ) : (
              <span className="nh-chip bg-white/15 text-white/80">{t("Already used")}</span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
