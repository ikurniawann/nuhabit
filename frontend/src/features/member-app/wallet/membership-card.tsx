"use client";

import Link from "next/link";
import { useState } from "react";
import { BottomSheet } from "../components/bottom-sheet";
import { ApiError } from "../lib/api";
import { activeMethod, type FreezeAllowance, type PassView, type RenewWith } from "../lib/classes-view";
import { fill, useT } from "../lib/i18n";
import { m } from "../lib/links";
import { usePassMutation, useSavedMethods, type PassAction } from "../lib/queries-classes";
import { Toggle } from "../train/record/option-row";
import { formatDay } from "../ui";

const RENEW_LABELS: Record<RenewWith, string> = { ark: "ARK Coin", invoice: "Online invoice", saved_method: "Saved method" };

/** Freeze lengths offered: the minimum, two and four weeks, within what is left. */
function freezeChoices(f: FreezeAllowance): number[] {
  return [...new Set([f.min_days, 14, 28, f.remaining_days])]
    .filter((d) => d >= f.min_days && d <= f.remaining_days)
    .sort((a, b) => a - b);
}

/** Kartu membership: status pass, tanggal berakhir, bekukan dan perpanjang otomatis. */
export function MembershipCard({
  pass,
  next,
  freeze,
}: {
  pass: PassView;
  next: PassView | null;
  freeze: FreezeAllowance | null;
}) {
  const t = useT();
  const change = usePassMutation();
  const { data: saved } = useSavedMethods();
  const method = activeMethod(saved);
  // The saved-method choice shows only while the feature is on (or already picked).
  const renewChoices = (Object.keys(RENEW_LABELS) as RenewWith[]).filter(
    (w) => w !== "saved_method" || saved?.enabled || pass.renewWith === w
  );
  const renewLabel = (w: RenewWith) => (w === "saved_method" && method?.label ? method.label : t(RENEW_LABELS[w]));
  const [sheet, setSheet] = useState(false);
  const [error, setError] = useState("");
  const frozen = pass.status === "frozen";
  const choices = freeze ? freezeChoices(freeze) : [];

  const run = (action: PassAction, then?: () => void) => {
    setError("");
    change.mutate(action, {
      onSuccess: then,
      onError: (e) => setError(e instanceof ApiError ? e.message : t("Could not update your pass.")),
    });
  };

  return (
    <>
      <div className="nh-card nh-surface-ink relative overflow-hidden !border-0 !p-6 text-white">
        <div className="pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full bg-nh-lime/20 blur-3xl" />
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-bold tracking-[0.22em] text-white/50 uppercase">
            {t(frozen ? "Frozen membership" : "Active membership")}
          </p>
          {pass.autoRenew ? (
            <span className="nh-chip bg-nh-lime text-nh-ink">{t("Auto-renew")}</span>
          ) : null}
        </div>
        <p className="nh-display mt-1 text-3xl leading-tight">{pass.name}</p>
        <p className="mt-3 flex items-baseline gap-2">
          <span className="nh-display text-6xl leading-none">{pass.daysLeft}</span>
          <span className="text-sm font-bold text-white/70">{t(frozen ? "days left, paused" : "days left")}</span>
        </p>
        <p className="mt-2 rounded-lg bg-black/25 px-3 py-1.5 text-xs font-bold">
          {frozen
            ? `${t("Frozen until")} ${formatDay(pass.frozenUntil ?? pass.endsAt)}. ${t("Your end date moves out by the days you stay frozen.")}`
            : `${t("Unlimited bookings until")} ${formatDay(pass.endsAt)}`}
        </p>
        {next ? (
          <p className="mt-2 text-xs font-bold text-white/70">
            {t("Next pass starts")} {formatDay(next.startsAt)}: {next.name}
          </p>
        ) : null}
      </div>

      <div className="nh-card flex flex-col gap-3 !py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-extrabold">{t("Auto-renew")}</p>
            <p className="text-xs text-nh-muted">
              {pass.autoRenew
                ? `${t("Renews before it ends, paid with")} ${renewLabel(pass.renewWith)}`
                : `${t("Off - your pass ends on")} ${formatDay(pass.endsAt)}`}
            </p>
            {!pass.autoRenew && pass.autoRenewOffReason === "renewal_failed" ? (
              <p className="text-xs font-bold text-nh-danger">
                {t("Auto-renew was turned off after the renewal payment failed.")}
              </p>
            ) : null}
          </div>
          <Toggle
            on={pass.autoRenew}
            label={t("Auto-renew")}
            onChange={(on) => run({ kind: "auto-renew", passId: pass.id, autoRenew: on })}
          />
        </div>
        {pass.autoRenew ? (
          <div className="flex flex-wrap gap-2">
            {renewChoices.map((w) =>
              w === "saved_method" && !method && pass.renewWith !== w ? (
                <Link key={w} href={m("/profile/payment-methods")} className="nh-chip bg-nh-raised text-nh-muted">
                  {t("Link a payment method")}
                </Link>
              ) : (
                <button
                  key={w}
                  type="button"
                  aria-pressed={pass.renewWith === w}
                  disabled={change.isPending}
                  onClick={() => run({ kind: "auto-renew", passId: pass.id, autoRenew: true, renewWith: w })}
                  className={`nh-chip ${pass.renewWith === w ? "bg-nh-ink text-white" : "bg-nh-raised text-nh-muted"}`}
                >
                  {renewLabel(w)}
                </button>
              )
            )}
          </div>
        ) : null}

        {frozen ? (
          <button
            type="button"
            className="nh-btn-brand"
            disabled={change.isPending}
            onClick={() => run({ kind: "unfreeze", passId: pass.id })}
          >
            {t("Unfreeze now")}
          </button>
        ) : freeze && freeze.max_days_per_year > 0 ? (
          <>
            <button type="button" className="nh-btn-ghost" disabled={choices.length === 0} onClick={() => setSheet(true)}>
              {t("Freeze pass")}
            </button>
            <p className="text-center text-xs text-nh-muted">
              {choices.length === 0
                ? t("No freeze days left this year.")
                : `${t("Freeze days left this year")}: ${freeze.remaining_days} ${t("days")}`}
            </p>
          </>
        ) : null}
        {error ? <p className="text-center text-xs font-bold text-nh-danger">{error}</p> : null}
      </div>

      {sheet ? (
        <BottomSheet title={t("Freeze pass")} kicker={pass.name} onClose={() => setSheet(false)}>
          <p className="mb-4 text-sm text-nh-muted">
            {t("Bookings and gate entry pause while your pass is frozen.")}{" "}
            {t("Your end date moves out by the days you stay frozen.")}
          </p>
          <div className="flex flex-col gap-2">
            {choices.map((days) => (
              <button
                key={days}
                type="button"
                className="nh-btn-ghost"
                disabled={change.isPending}
                onClick={() => run({ kind: "freeze", passId: pass.id, days }, () => setSheet(false))}
              >
                {fill(t("Freeze for {n} days"), { n: days })}
              </button>
            ))}
          </div>
          {error ? <p className="mt-3 text-center text-xs font-bold text-nh-danger">{error}</p> : null}
        </BottomSheet>
      ) : null}
    </>
  );
}
