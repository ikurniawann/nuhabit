"use client";

import { Check, Crown } from "lucide-react";
import { formatRupiah } from "@/lib/format";
import { useT } from "../lib/i18n";
import { spendProgressPct, tierPerkKeys, useMembership, type MembershipView } from "../lib/queries-progress";
import { EmptyState, Spinner, formatDay } from "../ui";
import { PageTitle, SectionHeader } from "./loyalty-ui";

/** Tier membership dari belanja 12 bulan: sisa belanja ke tier berikutnya, perks, tangga tier, riwayat. */
export function MembershipPage() {
  const t = useT();
  const { data, isLoading, error } = useMembership();

  if (isLoading) return <Spinner label={t("Loading membership…")} />;
  if (error || !data) return <EmptyState title={t("Could not load your membership")} />;

  return (
    <div className="flex flex-col gap-5">
      <PageTitle hint={t("Your tier follows what you spent in the last 12 months at the gym, café and shop.")}>
        {t("Membership")}
      </PageTitle>
      {!data.enabled ? (
        <EmptyState title={t("Membership tiers are coming soon")} />
      ) : (
        <>
          <TierCard view={data} />
          <Perks view={data} />
          <Ladder view={data} />
          {data.history.length > 0 ? (
            <section>
              <SectionHeader label={t("Tier history")} />
              <div className="nh-card flex flex-col divide-y divide-nh-line !py-1 text-sm">
                {data.history.map((h) => (
                  <p key={h.created_at + h.direction} className="flex justify-between gap-3 py-2.5">
                    <span>
                      {h.direction === "up"
                        ? t("Moved up to {tier}", { tier: h.to_tier_name ?? "-" })
                        : t("Moved down to {tier}", { tier: h.to_tier_name ?? t("No tier") })}
                    </span>
                    <span className="shrink-0 text-xs text-nh-muted">{formatDay(h.created_at)}</span>
                  </p>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function TierCard({ view }: { view: MembershipView }) {
  const t = useT();
  return (
    <div className="nh-card nh-surface-ink relative overflow-hidden !border-0 !p-6 text-white">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold tracking-[0.22em] text-white/50 uppercase">{t("Your tier")}</p>
        {view.tier?.color ? <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: view.tier.color }} /> : null}
      </div>
      <p className="nh-display mt-1 text-5xl leading-none">{view.tier?.name ?? t("No tier yet")}</p>
      <p className="mt-2 text-xs font-semibold text-white/60">
        {t("{amount} spent in the last 12 months", { amount: formatRupiah(view.spend.total_idr) })}
      </p>
      {view.next ? (
        <div className="mt-5">
          <div className="h-2.5 overflow-hidden rounded-full bg-white/15">
            <span className="nh-surface-brand block h-full rounded-full" style={{ width: `${spendProgressPct(view)}%` }} />
          </div>
          <p className="mt-2 text-sm font-bold">
            {t("{amount} more to {tier}", { amount: formatRupiah(view.next.spend_needed_idr), tier: view.next.tier.name })}
          </p>
        </div>
      ) : view.tier ? (
        <p className="mt-5 text-sm font-bold">{t("You reached the top tier")}</p>
      ) : null}
      {view.valid_until ? (
        <p className="mt-3 text-xs text-white/60">{t("Tier held until {date}", { date: formatDay(view.valid_until) })}</p>
      ) : null}
      {view.keep ? (
        <p className="mt-1 text-xs text-white/60">
          {t("Spend {amount} more to keep it after that", { amount: formatRupiah(view.keep.spend_needed_idr) })}
        </p>
      ) : null}
    </div>
  );
}

function Perks({ view }: { view: MembershipView }) {
  const t = useT();
  if (!view.tier) return null;
  const system = tierPerkKeys(view.tier);
  return (
    <section>
      <SectionHeader label={t("Your perks")} />
      {view.frozen ? (
        <p className="mb-3 rounded-2xl bg-nh-warn/15 px-4 py-3 text-sm font-semibold text-nh-ink">
          {t("Your perks are paused while your account is suspended or blocked.")}
        </p>
      ) : null}
      <ul className="nh-card flex flex-col gap-2.5 text-sm">
        {system.map((p) => (
          <li key={p.key} className="flex items-start gap-2.5">
            <Check size={16} className="mt-0.5 shrink-0 text-nh-ok" />
            {t(p.key, p.vars)}
          </li>
        ))}
        {view.tier.perks.map((p) => (
          <li key={p} className="flex items-start gap-2.5">
            <Check size={16} className="mt-0.5 shrink-0 text-nh-ok" />
            {p}
          </li>
        ))}
        {system.length === 0 && view.tier.perks.length === 0 ? <li className="text-nh-muted">{t("No perks on this tier yet")}</li> : null}
      </ul>
    </section>
  );
}

function Ladder({ view }: { view: MembershipView }) {
  const t = useT();
  return (
    <section>
      <SectionHeader label={t("All tiers")} />
      <div className="nh-card flex flex-col divide-y divide-nh-line !py-1 text-sm">
        {view.tiers.map((tier) => {
          const current = tier.id === view.tier?.id;
          return (
            <div key={tier.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-bold">
                  {current ? <Crown size={14} /> : null}
                  {tier.name}
                </span>
                <span className="block truncate text-xs text-nh-muted">
                  {[t("From {amount}", { amount: formatRupiah(tier.min_spend_idr) }), ...tierPerkKeys(tier).map((p) => t(p.key, p.vars))].join(" · ")}
                </span>
              </span>
              {current ? <span className="nh-chip shrink-0 bg-nh-forest text-white">{t("Current")}</span> : null}
            </div>
          );
        })}
      </div>
      <ProgressNote />
    </section>
  );
}

function ProgressNote() {
  const t = useT();
  return (
    <p className="mt-3 px-1 text-xs text-nh-muted">
      {t("Membership is separate from Progress: XP from training keeps its own tier. Where both give a discount you get the higher one.")}
    </p>
  );
}
