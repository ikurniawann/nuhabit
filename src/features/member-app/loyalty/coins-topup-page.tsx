"use client";

import { QrCode } from "lucide-react";
import { useState } from "react";
import { formatNumber, formatRp, topupAmountError } from "@/lib/member-app/loyalty";
import { ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { createArkTopup, loyaltyKeys, useRefresh, useTopupOptions, type TopupChoice } from "../lib/queries-loyalty";
import { EmptyState, Spinner } from "../ui";
import { ArkTopupPayment } from "./ark-topup-payment";
import { Notice, PageTitle, SectionHeader } from "./loyalty-ui";

/** Top-up ARK Coin mandiri: pilih paket atau nominal, bayar QRIS, saldo masuk otomatis. */
export function CoinsTopupPage() {
  const t = useT();
  const refresh = useRefresh();
  const { data, isLoading, error: loadError } = useTopupOptions();
  const [choice, setChoice] = useState<TopupChoice | null>(null);
  const [custom, setCustom] = useState("");
  // undefined = belum memilih: QR yang masih berlaku dari kunjungan sebelumnya dilanjutkan.
  const [chosenId, setChosenId] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const activeId = chosenId === undefined ? (data?.pending_id ?? null) : chosenId;

  const startOver = () => {
    setChosenId(null);
    setChoice(null);
    setCustom("");
    setError("");
    void refresh(loyaltyKeys.topupOptions);
  };

  if (activeId) {
    return <ArkTopupPayment topupId={activeId} canSimulate={data?.can_simulate ?? false} onDone={startOver} />;
  }
  if (isLoading) return <Spinner label={t("Loading top-up…")} />;
  if (!data) {
    return (
      <div className="flex flex-col gap-5">
        <PageTitle>{t("Top up ARK")}</PageTitle>
        <Notice ok={false}>{loadError instanceof Error ? loadError.message : t("Request failed")}</Notice>
      </div>
    );
  }

  const selectedPackage = choice && "packageId" in choice ? data.packages.find((p) => p.id === choice.packageId) : null;
  const pay = selectedPackage?.price_idr ?? (choice && "amount" in choice ? choice.amount : 0);
  const credit = selectedPackage?.credit_idr ?? pay;
  const amountError =
    choice && "amount" in choice ? topupAmountError(t, choice.amount, data.min_amount, data.max_amount) : null;

  const create = async () => {
    if (!choice) return;
    setBusy(true);
    setError("");
    try {
      const topup = await createArkTopup(choice);
      setChosenId(topup.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Request failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageTitle hint={t("Pay with QRIS from any bank or e-wallet app. Your balance updates automatically.")}>
        {t("Top up ARK")}
      </PageTitle>

      <div className="nh-card nh-surface-ink !border-0 !p-5 text-white">
        <p className="text-[10px] font-bold tracking-[0.22em] text-white/50 uppercase">{t("Current balance")}</p>
        <p className="nh-display mt-1 text-4xl tabular-nums">
          {formatNumber(Math.floor(data.balance / Math.max(1, data.ark_rate)))} ARK
        </p>
        <p className="mt-1 text-xs font-semibold text-white/45">≈ {formatRp(data.balance)}</p>
      </div>

      {data.packages.length > 0 ? (
        <section>
          <SectionHeader label={t("Packages")} />
          <div className="flex flex-col gap-2">
            {data.packages.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setChoice({ packageId: p.id });
                  setCustom("");
                }}
                className={`nh-card flex items-center justify-between gap-3 !p-4 text-left active:scale-[0.99] ${
                  selectedPackage?.id === p.id ? "ring-2 ring-nh-forest" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-extrabold">{p.name}</p>
                  <p className="text-xs text-nh-muted">
                    {t("Get {amount}", { amount: formatRp(p.credit_idr) })}
                    {p.validity_days ? ` · ${t("valid {n} days", { n: p.validity_days })}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="nh-display text-lg tabular-nums">{formatRp(p.price_idr)}</p>
                  {p.bonus_idr > 0 ? (
                    <span className="nh-chip bg-nh-lime text-nh-ink">+{formatRp(p.bonus_idr)}</span>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <SectionHeader label={t("Custom amount")} />
        {data.presets.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {data.presets.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setChoice({ amount: v });
                  setCustom(formatNumber(v));
                }}
                className={`nh-chip ${
                  choice && "amount" in choice && choice.amount === v
                    ? "bg-nh-ink text-white"
                    : "bg-nh-raised text-nh-ink"
                }`}
              >
                {formatRp(v)}
              </button>
            ))}
          </div>
        ) : null}
        <label className="nh-label" htmlFor="topup-amount">
          {t("Amount (Rp)")}
        </label>
        <input
          id="topup-amount"
          className="nh-input"
          inputMode="numeric"
          placeholder={t("Minimum {amount}", { amount: formatRp(data.min_amount) })}
          value={custom}
          onChange={(e) => {
            const digits = Number(e.target.value.replace(/\D/g, "")) || 0;
            setCustom(digits ? formatNumber(digits) : "");
            setChoice(digits ? { amount: digits } : null);
          }}
        />
        {amountError ? <p className="mt-1.5 text-xs font-semibold text-nh-danger">{amountError}</p> : null}
      </section>

      {data.packages.length === 0 && data.presets.length === 0 ? (
        <EmptyState title={t("No packages yet")} hint={t("Enter a top-up amount above.")} />
      ) : null}

      {error ? <Notice ok={false}>{error}</Notice> : null}

      <div className="nh-card flex items-center justify-between gap-3 !p-4">
        <div>
          <p className="text-xs text-nh-muted">{t("You receive")}</p>
          <p className="nh-display text-2xl tabular-nums">{formatRp(credit)}</p>
        </div>
        <button
          type="button"
          className="nh-btn-brand"
          disabled={!choice || pay <= 0 || Boolean(amountError) || busy}
          onClick={() => void create()}
        >
          <QrCode size={18} /> {busy ? t("Creating QR…") : t("Pay {amount}", { amount: formatRp(pay) })}
        </button>
      </div>
    </div>
  );
}
