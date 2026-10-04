"use client";

import { AlertTriangle, ChevronRight, Coins } from "lucide-react";
import Link from "next/link";
import { isLowBalance } from "@/lib/member-portal/balance";
import { formatNumber, formatRupiah } from "@/lib/format";
import { idrToArkDisplay } from "@/lib/pos/loyalty-settings";
import { isCreditEntry } from "@/lib/wallet/ledger";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { useLoyaltyMe, useTransactions } from "../lib/queries-loyalty";
import { EmptyState, Spinner, formatDayTime } from "../ui";
import { PageTitle, SectionHeader } from "./loyalty-ui";

/** Label jenis baris dompet ARK (pos_wallet_transactions.type). */
const TXN_LABELS: Record<string, string> = {
  topup: "Top-up",
  topup_bonus: "Top-up bonus",
  payment: "Payment",
  refund: "Refund",
  bonus: "Bonus",
  expiration: "Expired",
  adjustment: "Adjustment",
  reversal: "Reversal",
  topup_refund: "Top-up refund",
  withdrawal: "Balance withdrawal",
};

/** Saldo ARK Coin, tombol top-up, dan riwayat koin (port layar ARK Coin portal lama). */
export function CoinsPage() {
  const t = useT();
  const { data: me, isLoading } = useLoyaltyMe();
  const { data: txn } = useTransactions();

  if (isLoading || !me) return <Spinner label={t("Loading ARK Coin…")} />;
  const low = isLowBalance(me.coinsIdr, me.lowBalanceThresholdIdr);
  const wallet = txn?.wallet ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageTitle>ARK Coin</PageTitle>

      <div className="nh-card nh-surface-ink relative overflow-hidden !border-0 !p-6 text-white">
        <div className="pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full bg-nh-lime/20 blur-3xl" />
        <p className="relative text-[10px] font-bold tracking-[0.22em] text-white/50 uppercase">
          {t("ARK Coin balance")}
        </p>
        <p className="nh-display relative mt-1 text-7xl leading-none tabular-nums">{formatNumber(me.coins)}</p>
        <p className="relative mt-2 text-xs font-semibold text-white/45">≈ {formatRupiah(me.coinsIdr)}</p>
        <div className="relative mt-5 flex items-center justify-between gap-3">
          <p className="truncate text-xs font-semibold text-white/45">{me.profile.name ?? "Member"}</p>
          {me.tier ? <span className="nh-chip shrink-0 bg-white/10 text-white/80">{me.tier.name}</span> : null}
        </div>
      </div>

      {low ? (
        <Link
          href={m("/coins/topup")}
          className="flex items-center gap-2 rounded-2xl bg-nh-warn/15 px-4 py-3 text-sm font-bold text-nh-ink"
        >
          <AlertTriangle size={16} className="shrink-0 text-nh-warn" />
          <span className="flex-1">{t("Balance is running low. Top up now")}</span>
          <ChevronRight size={16} className="text-nh-muted" />
        </Link>
      ) : null}

      <Link href={m("/coins/topup")} className="nh-btn-brand w-full">
        <Coins size={17} /> {t("Top up now")}
      </Link>
      <p className="rounded-2xl bg-nh-lime-soft px-4 py-3 text-sm font-semibold text-nh-forest">
        {t("You can also top up at any cashier. Your balance works at every venue.")}
      </p>

      <section>
        <SectionHeader label={t("Coin history")} />
        {wallet.length === 0 ? (
          <EmptyState title={t("No coin activity yet")} hint={t("Your first top-up will show up here.")} />
        ) : (
          <div className="nh-card divide-y divide-nh-line !py-1">
            {wallet.map((row) => {
              // adjustment/reversal bisa dua arah: tanda amount yang menentukan.
              const credit = isCreditEntry(row.type, row.amountIdr);
              return (
                <div key={row.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{t(TXN_LABELS[row.type] ?? row.type)}</p>
                    <p className="text-xs text-nh-muted">{formatDayTime(row.createdAt)}</p>
                  </div>
                  <span
                    className={`nh-display text-xl font-black tabular-nums ${credit ? "text-nh-ok" : "text-nh-danger"}`}
                  >
                    {credit ? "+" : "−"}
                    {formatNumber(Math.abs(idrToArkDisplay(row.amountIdr, me.arkRate)))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
