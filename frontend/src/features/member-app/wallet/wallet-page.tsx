"use client";

import Link from "next/link";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { useWallet } from "../lib/queries-classes";
import { Spinner, StatusBadge, formatDay, formatDayTime } from "../ui";

/** Gym credit ledger types (gym.credit_ledger.type, upper-cased). */
const ENTRY_LABEL: Record<string, string> = {
  TOP_UP: "Top up",
  CLASS_DEDUCTION: "Class",
  REFUND: "Refund",
  BONUS: "Bonus",
  EXPIRATION: "Expired",
  ADJUSTMENT: "Adjustment",
  REVERSAL: "Reversal",
};

export function WalletPage() {
  const t = useT();
  const { data: wallet, isLoading } = useWallet();
  if (isLoading || !wallet) return <Spinner label={t("Loading wallet…")} />;

  const label = (type: string) => t(ENTRY_LABEL[type] ?? type);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="nh-display text-3xl font-black">{t("Wallet")}</h1>

      <div className="nh-card nh-surface-ink relative overflow-hidden !border-0 !p-6 text-white">
        <div className="pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full bg-nh-lime/20 blur-3xl" />
        {wallet.activePass ? (
          <>
            <p className="text-[10px] font-bold tracking-[0.22em] text-white/50 uppercase">{t("Active pass")}</p>
            <p className="nh-display mt-1 text-3xl leading-tight">{wallet.activePass.name}</p>
            <p className="mt-3 flex items-baseline gap-2">
              <span className="nh-display text-6xl leading-none">{wallet.activePass.daysLeft}</span>
              <span className="text-sm font-bold text-white/70">{t("days left")}</span>
            </p>
            <p className="mt-2 rounded-lg bg-black/25 px-3 py-1.5 text-xs font-bold">
              {t("Unlimited bookings until")} {formatDay(wallet.activePass.endsAt)}
            </p>
          </>
        ) : (
          <>
            <p className="text-[10px] font-bold tracking-[0.22em] text-white/50 uppercase">{t("Credit balance")}</p>
            <p className="nh-display mt-1 text-7xl leading-none">{wallet.balance}</p>
            {wallet.expiringCredits > 0 ? (
              <p className="mt-2 rounded-lg bg-black/25 px-3 py-1.5 text-xs font-bold">
                {wallet.expiringCredits} {t("expiring within the reminder window")}
              </p>
            ) : null}
          </>
        )}
      </div>

      <Link href={m("/wallet/topup")} className="nh-btn-brand">
        {wallet.activePass ? t("Buy a package or pass") : t("Top up credits")}
      </Link>

      {wallet.activePass ? (
        <div className="nh-card flex items-center justify-between !py-4 text-sm">
          <span className="text-nh-muted">{t("Credit balance")}</span>
          <span className="nh-display text-xl">{wallet.balance}</span>
        </div>
      ) : null}

      {wallet.passes.some((p) => p.status !== "active") ? (
        <section>
          <h2 className="nh-display mb-2 text-xl font-black">{t("Past passes")}</h2>
          <div className="flex flex-col gap-2">
            {wallet.passes
              .filter((p) => p.status !== "active")
              .map((p) => (
                <div key={p.id} className="nh-card flex items-center justify-between gap-3 !py-4 opacity-60">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold">{p.name}</p>
                    <p className="text-xs text-nh-muted">
                      {formatDay(p.startsAt)} · {formatDay(p.endsAt)}
                    </p>
                  </div>
                  <span className="nh-chip shrink-0 bg-nh-raised text-nh-muted">
                    {p.status === "refunded" ? t("Refunded") : t("Ended")}
                  </span>
                </div>
              ))}
          </div>
        </section>
      ) : null}

      {wallet.myPackages.length > 0 ? (
        <section>
          <h2 className="nh-display mb-2 text-xl font-black">{t("My packages")}</h2>
          <div className="flex flex-col gap-2">
            {wallet.myPackages.map((p) => (
              <div key={p.lotId} className={`nh-card !py-4 ${p.active ? "" : "opacity-60"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold">{t(p.name)}</p>
                    <p className="text-xs text-nh-muted">
                      {p.credits} {t("credits")} · {t("bought")} {formatDay(p.purchasedAt)}
                    </p>
                  </div>
                  <span
                    className={`nh-chip shrink-0 ${p.active ? "bg-nh-ok/10 text-nh-ok" : "bg-nh-raised text-nh-muted"}`}
                  >
                    {p.active ? `${t("Valid until")} ${formatDay(p.expiresAt)}` : t("Expired")}
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {p.coverageNames ? (
                    p.coverageNames.map((n) => (
                      <span key={n} className="nh-chip bg-nh-forest/10 text-nh-forest">
                        {n}
                      </span>
                    ))
                  ) : (
                    <span className="nh-chip bg-nh-raised text-nh-muted">{t("All classes")}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="nh-display mb-2 text-xl font-black">{t("Transaction history")}</h2>
        <div className="flex flex-col gap-2">
          {wallet.entries.map((e) => (
            <div key={e.id} className="nh-card flex items-center justify-between gap-3 !p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{e.description || label(e.type)}</p>
                <p className="text-xs text-nh-muted">
                  {formatDayTime(e.createdAt)} ·{" "}
                  <StatusBadge status={label(e.type)} tone={e.amount >= 0 ? "ok" : "neutral"} />
                </p>
              </div>
              <span className={`nh-display text-xl font-black ${e.amount >= 0 ? "text-nh-ok" : "text-nh-danger"}`}>
                {e.amount > 0 ? `+${e.amount}` : e.amount}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
