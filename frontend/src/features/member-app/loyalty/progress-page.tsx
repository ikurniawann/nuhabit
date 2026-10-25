"use client";

import { Flame, Trophy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { tierProgressPct } from "@/lib/member-app/loyalty";
import { formatNumber, formatRupiah } from "@/lib/format";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { useLeaderboard, useProgress, type ProgressView } from "../lib/queries-progress";
import { EmptyState, Spinner, formatDay } from "../ui";
import { PageTitle, ProgressBar, SectionHeader } from "./loyalty-ui";

/** XP sources as English dictionary keys. */
export const XP_SOURCE: Record<string, string> = {
  class_attended: "Class attended",
  pt_attended: "PT session attended",
  offpeak_attended: "Off-peak bonus",
  weekly_streak: "Weekly streak",
  streak_4w: "4-week streak",
  package_purchase: "Package purchase",
  early_renewal: "Early renewal bonus",
};

/** Progres: XP dari latihan, streak mingguan, cara dapat XP, riwayat, dan leaderboard kehadiran. */
export function ProgressPage() {
  const t = useT();
  const { data, isLoading, error } = useProgress();

  if (isLoading) return <Spinner label={t("Loading progress…")} />;
  if (error || !data) return <EmptyState title={t("Could not load your progress")} />;

  return (
    <div className="flex flex-col gap-5">
      <PageTitle hint={t("Earn XP by showing up. Your XP tier never drops.")}>{t("Progress")}</PageTitle>
      {data.frozen ? (
        <p className="rounded-2xl bg-nh-warn/15 px-4 py-3 text-sm font-semibold text-nh-ink">
          {t("XP and the leaderboard are paused while your account is suspended or blocked.")}
        </p>
      ) : null}
      <XPCard view={data} />
      <Streak view={data} />
      <Rules view={data} />
      <Leaderboard />
      {data.history.length > 0 ? (
        <section>
          <SectionHeader label={t("Recent XP")} />
          <div className="nh-card flex flex-col divide-y divide-nh-line !py-1 text-sm">
            {data.history.map((h, i) => (
              <div key={`${h.created_at}-${i}`} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block font-bold">{XP_SOURCE[h.source_type] ? t(XP_SOURCE[h.source_type]) : h.description}</span>
                  <span className="block truncate text-xs text-nh-muted">
                    {h.description} · {formatDay(h.created_at)}
                  </span>
                </span>
                <span className="shrink-0 font-bold tabular-nums">{h.xp > 0 ? `+${formatNumber(h.xp)}` : formatNumber(h.xp)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function XPCard({ view }: { view: ProgressView }) {
  const t = useT();
  const { xp } = view;
  return (
    <section className="nh-card">
      <div className="flex items-baseline justify-between gap-3">
        <p className="nh-display text-2xl">{xp.tier?.name ?? "Member"}</p>
        <p className="text-sm font-bold tabular-nums">{t("{n} XP", { n: formatNumber(xp.lifetime_xp) })}</p>
      </div>
      <div className="mt-3">
        <ProgressBar pct={tierProgressPct(xp.lifetime_xp, xp.next_tier?.min_lifetime_xp ?? null)} label={t("Progress to the next tier")} />
      </div>
      <p className="mt-2 text-xs text-nh-muted">
        {xp.next_tier
          ? t("{n} XP to {tier}", { n: formatNumber(Math.max(xp.next_tier.min_lifetime_xp - xp.lifetime_xp, 0)), tier: xp.next_tier.name })
          : t("You reached the top tier")}
      </p>
    </section>
  );
}

function Streak({ view }: { view: ProgressView }) {
  const t = useT();
  const min = view.rules.weekly_streak_min_sessions;
  return (
    <section className="grid grid-cols-2 gap-3">
      <div className="nh-card nh-surface-brand !border-0 text-nh-forest">
        <Flame size={18} />
        <p className="nh-display mt-2 text-4xl leading-none tabular-nums">{formatNumber(view.streak_weeks)}</p>
        <p className="mt-1 text-xs font-bold">{t("{n}-week streak", { n: view.streak_weeks })}</p>
      </div>
      <div className="nh-card">
        <p className="nh-display text-4xl leading-none tabular-nums">
          {formatNumber(view.week_sessions)}
          <span className="text-lg text-nh-muted">/{formatNumber(min)}</span>
        </p>
        <p className="mt-1 text-xs text-nh-muted">{t("Sessions this week")}</p>
        <p className="mt-2 text-xs text-nh-muted">{t("{n} this month", { n: formatNumber(view.month_sessions) })}</p>
      </div>
    </section>
  );
}

function Rules({ view }: { view: ProgressView }) {
  const t = useT();
  const r = view.rules;
  const lines = [
    { label: t("Attend a class"), xp: r.xp_class_attended },
    { label: t("Attend a PT session"), xp: r.xp_pt_attended },
    { label: t("Off-peak class bonus"), xp: r.xp_offpeak_bonus },
    { label: t("Weekly streak ({n} sessions in a week)", { n: r.weekly_streak_min_sessions }), xp: r.xp_weekly_streak },
    { label: t("Every 4 weeks in a row"), xp: r.xp_streak_4w },
    { label: t("Renew before your package runs out"), xp: r.xp_early_renewal },
  ].filter((l) => l.xp > 0);
  return (
    <section>
      <SectionHeader label={t("How to earn XP")} />
      <div className="nh-card flex flex-col divide-y divide-nh-line !py-1 text-sm">
        {lines.map((l) => (
          <p key={l.label} className="flex justify-between gap-3 py-2.5">
            <span>{l.label}</span>
            <span className="shrink-0 font-bold tabular-nums">+{formatNumber(l.xp)}</span>
          </p>
        ))}
        {r.xp_purchase_per_step > 0 ? (
          <p className="flex justify-between gap-3 py-2.5">
            <span>{t("Buy a package")}</span>
            <span className="shrink-0 text-right font-bold tabular-nums">
              {t("+{n} per {amount}", { n: formatNumber(r.xp_purchase_per_step), amount: formatRupiah(r.purchase_step_idr) })}
            </span>
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Leaderboard() {
  const t = useT();
  const [branch, setBranch] = useState("");
  const { data, isLoading } = useLeaderboard(branch);

  return (
    <section>
      <SectionHeader label={t("Leaderboard this month")} />
      <div className="nh-card flex flex-col gap-3 text-sm">
        {data && data.branches.length > 1 ? (
          <select
            className="nh-input"
            aria-label={t("Branch")}
            value={branch || data.branch?.id || ""}
            onChange={(e) => setBranch(e.target.value)}
          >
            {data.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : null}
        {isLoading || !data ? (
          <Spinner label={t("Loading leaderboard…")} />
        ) : data.entries.length === 0 ? (
          <p className="text-nh-muted">{t("No check-ins at this branch yet this month.")}</p>
        ) : (
          <ol className="flex flex-col divide-y divide-nh-line">
            {data.entries.map((e, i) => (
              <li
                key={`${e.alias}-${i}`}
                className={`flex items-center justify-between gap-3 py-2 ${e.me ? "rounded-xl bg-nh-lime-soft px-2 font-bold text-nh-forest" : ""}`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex w-8 shrink-0 items-center gap-1 tabular-nums">
                    {e.rank === 1 ? <Trophy size={12} aria-hidden /> : null}
                    {e.rank}
                  </span>
                  <span className="truncate">{e.me ? t("You") : e.alias}</span>
                </span>
                <span className="shrink-0 tabular-nums">{t("{n} sessions", { n: e.sessions })}</span>
              </li>
            ))}
          </ol>
        )}
        {data?.me ? (
          <p className="text-xs text-nh-muted">
            {data.me.visible
              ? t("You are #{rank} with {n} sessions.", { rank: data.me.rank ?? "-", n: data.me.sessions })
              : data.me.show_on_leaderboard
                ? t("Check in to a class to join the board.")
                : t("You are hidden from the leaderboard.")}{" "}
            {!data.me.show_on_leaderboard ? (
              <Link href={m("/profile/settings")} className="font-bold underline">
                {t("Change in settings")}
              </Link>
            ) : null}
          </p>
        ) : null}
      </div>
    </section>
  );
}
