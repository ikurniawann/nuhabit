"use client";

import { ArrowLeft, Check } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { buyPackage, useInvalidateAll, usePackages } from "../lib/queries-classes";
import { Spinner, formatIdr } from "../ui";

/** Payment methods the gym credit purchase API accepts. */
type PaymentChannel = "qris" | "ark_coin";

const CHANNELS: { id: PaymentChannel; label: string }[] = [
  { id: "qris", label: "QRIS" },
  { id: "ark_coin", label: "ARK Coin" },
];

/** useSearchParams needs a Suspense boundary for prerendering. */
export function TopUpPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <TopUp />
    </Suspense>
  );
}

function TopUp() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const invalidate = useInvalidateAll();
  const { data, isLoading } = usePackages();
  const [packageId, setPackageId] = useState("");
  const [channel, setChannel] = useState<PaymentChannel>("qris");
  // Promo cards on Home deep-link here with the code prefilled.
  const [voucherCode, setVoucherCode] = useState((searchParams.get("voucher") ?? "").toUpperCase());
  const [voucherError, setVoucherError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (isLoading || !data) return <Spinner label={t("Loading packages…")} />;

  const { packages, arkEnabled } = data;
  const channels = CHANNELS.filter((c) => c.id !== "ark_coin" || arkEnabled);
  const selected = packages.find((p) => p.id === packageId);

  // Credit package purchases take no voucher here; say so instead of failing silently.
  const checkVoucher = () => {
    if (!voucherCode || !packageId) return;
    setVoucherError(t("Vouchers can't be applied to credit packages yet."));
  };

  const checkout = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const purchase = await buyPackage(selected.id, channel);
      invalidate();
      router.push(m(`/wallet/pay/${purchase.id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Checkout failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-bold text-nh-muted">
        <ArrowLeft size={16} /> {t("Back")}
      </button>
      <h1 className="nh-display text-3xl font-black">{t("Top up")}</h1>

      <div className="flex flex-col gap-2">
        {packages.map((p) => (
          <button
            key={p.id}
            disabled={!p.canBuy}
            onClick={() => {
              setPackageId(p.id);
              setVoucherError("");
            }}
            className={`nh-card flex items-center justify-between text-left disabled:opacity-60 ${
              packageId === p.id ? "!border-nh-forest" : ""
            }`}
          >
            <div>
              <p className="font-black">{p.name}</p>
              <p className="text-sm text-nh-muted">
                {p.credits} {t("credits")} · {t("valid")} {p.validityDays} {t("days")}
              </p>
              <p className="mt-0.5 text-xs font-bold text-nh-muted">
                {p.coverageNames ? `${t("Covers:")} ${p.coverageNames.join(", ")}` : t("Valid for every class")}
              </p>
              {p.blockedReason ? <p className="mt-0.5 text-xs font-bold text-nh-warn">{p.blockedReason}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-black text-nh-forest">{formatIdr(p.priceIdr)}</span>
              {packageId === p.id ? <Check size={18} className="text-nh-forest" /> : null}
            </div>
          </button>
        ))}
      </div>

      {selected ? (
        <>
          <div>
            <label className="nh-label">{t("Voucher code")}</label>
            <div className="flex gap-2">
              <input
                className="nh-input flex-1 uppercase"
                value={voucherCode}
                onChange={(e) => {
                  setVoucherCode(e.target.value.toUpperCase());
                  setVoucherError("");
                }}
                placeholder="WELCOME10"
              />
              <button className="nh-btn-ghost !px-4 !py-2 text-sm" onClick={checkVoucher}>
                {t("Apply")}
              </button>
            </div>
            {voucherError ? <p className="mt-1.5 text-sm font-bold text-nh-danger">{voucherError}</p> : null}
          </div>

          <div>
            <label className="nh-label">{t("Payment method")}</label>
            <div className="grid grid-cols-2 gap-2">
              {channels.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setChannel(c.id)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-bold ${
                    channel === c.id
                      ? "border-nh-forest bg-nh-forest/10 text-nh-forest"
                      : "border-nh-line bg-nh-cream text-nh-muted"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="nh-card flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <span className="text-nh-muted">{selected.name}</span>
              <span>{formatIdr(selected.priceIdr)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-nh-line pt-2 font-black">
              <span>{t("Total")}</span>
              <span className="text-nh-forest">{formatIdr(selected.priceIdr)}</span>
            </div>
          </div>

          {error ? <p className="text-sm font-bold text-nh-danger">{error}</p> : null}
          <button className="nh-btn-brand" disabled={busy} onClick={() => void checkout()}>
            {t("Checkout")}
          </button>
        </>
      ) : null}
    </div>
  );
}
