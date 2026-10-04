"use client";

import { Gift, Lock } from "lucide-react";
import { useState } from "react";
import { formatNumber, tierProgressPct } from "@/lib/member-app/loyalty";
import { ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { loyaltyKeys, redeemReward, useLoyaltyMe, useRefresh, useRewards } from "../lib/queries-loyalty";
import { EmptyState, Spinner, formatDay } from "../ui";
import { Notice, PageTitle, ProgressBar, SectionHeader } from "./loyalty-ui";

const REDEMPTION_STATUS: Record<string, string> = {
  pending: "Waiting for pickup",
  approved: "Approved",
  fulfilled: "Picked up",
  cancelled: "Cancelled",
  rejected: "Rejected",
};

/** Tier & XP member plus reward yang bisa ditukar. XP hanya syarat: tidak berkurang saat menukar. */
export function RewardsPage() {
  const t = useT();
  const refresh = useRefresh();
  const { data: me } = useLoyaltyMe();
  const { data, isLoading, error: loadError } = useRewards();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const redeem = async (rewardId: string) => {
    setBusyId(rewardId);
    setMessage(null);
    try {
      const redemption = await redeemReward(rewardId);
      setMessage({
        ok: true,
        text: t("Request sent. Show code {code} at the cashier.", { code: redemption.redemption_number }),
      });
      await refresh(loyaltyKeys.rewards);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : t("Request failed") });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageTitle hint={t("Trade XP for rewards. Your XP stays the same.")}>{t("Rewards")}</PageTitle>

      {me ? (
        <section className="nh-card">
          <div className="flex items-baseline justify-between gap-3">
            <p className="nh-display text-2xl">{me.tier?.name ?? "Member"}</p>
            <p className="text-sm font-bold tabular-nums">{formatNumber(me.totalXp)} XP</p>
          </div>
          <div className="mt-3">
            <ProgressBar
              pct={tierProgressPct(me.totalXp, me.nextTier?.minLifetimeXp ?? null)}
              label={t("Progress to the next tier")}
            />
          </div>
          <p className="mt-2 text-xs text-nh-muted">
            {me.nextTier
              ? t("{n} XP to {tier}", { n: formatNumber(me.nextTier.xpNeeded), tier: me.nextTier.name })
              : t("You reached the top tier")}
          </p>
          {me.tiers.length > 0 ? (
            <div className="mt-4 divide-y divide-nh-line border-t border-nh-line text-sm">
              {me.tiers.map((tier) => {
                const current = tier.code === me.tier?.code;
                return (
                  <div key={tier.code} className="flex items-center justify-between gap-3 py-2.5">
                    <span>
                      <span className="block font-bold">{tier.name}</span>
                      <span className="block text-xs text-nh-muted">
                        {formatNumber(tier.minLifetimeXp)} XP · {t("{n}% off", { n: tier.discountPercent })}
                      </span>
                    </span>
                    <span className={`text-xs font-bold ${current ? "text-nh-ok" : "text-nh-muted"}`}>
                      {current ? t("Current") : me.totalXp >= tier.minLifetimeXp ? t("Reached") : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}

      {message ? <Notice ok={message.ok}>{message.text}</Notice> : null}
      {isLoading ? <Spinner label={t("Loading rewards…")} /> : null}
      {loadError ? <Notice ok={false}>{loadError.message}</Notice> : null}
      {data && data.rewards.length === 0 ? (
        <EmptyState title={t("No rewards to redeem yet")} hint={t("New rewards show up here.")} />
      ) : null}

      {data?.rewards.map((reward) => (
        <div key={reward.id} className="nh-card flex gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-nh-raised">
            {reward.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={reward.image_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <Gift size={22} className="text-nh-forest" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-extrabold">{reward.name}</p>
            <p className="text-xs text-nh-muted">
              {t("Min. {n} XP", { n: formatNumber(reward.min_xp) })}
              {reward.required_tier_name ? ` · ${t("{tier} tier", { tier: reward.required_tier_name })}` : ""}
              {reward.remaining_stock !== null ? ` · ${t("{n} left", { n: reward.remaining_stock })}` : ""}
            </p>
            {reward.eligible ? (
              <button
                type="button"
                className="nh-btn-brand mt-3 !px-4 !py-2 text-sm"
                disabled={busyId !== null}
                onClick={() => void redeem(reward.id)}
              >
                {busyId === reward.id ? t("Processing…") : t("Redeem")}
              </button>
            ) : (
              <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-nh-muted">
                <Lock size={12} />
                {reward.xp_needed > 0 ? t("{n} XP to go", { n: formatNumber(reward.xp_needed) }) : reward.reason}
              </p>
            )}
          </div>
        </div>
      ))}

      {data && data.history.length > 0 ? (
        <section>
          <SectionHeader label={t("Redemption history")} />
          <div className="nh-card divide-y divide-nh-line !py-1">
            {data.history.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-bold">{row.reward_name}</span>
                  <span className="block text-xs text-nh-muted">
                    {row.redemption_number} · {formatDay(row.requested_at)}
                  </span>
                </span>
                <span className="nh-chip shrink-0 bg-nh-raised">{t(REDEMPTION_STATUS[row.status] ?? row.status)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
