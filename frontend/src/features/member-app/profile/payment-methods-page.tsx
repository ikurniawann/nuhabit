"use client";

import { ArrowLeft, CreditCard, ShieldCheck, Wallet } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { ApiError } from "../lib/api";
import { activeMethod, type SavedMethod } from "../lib/classes-view";
import { useT } from "../lib/i18n";
import { linkSavedMethod, useSavedMethods, useUnlinkSavedMethod } from "../lib/queries-classes";
import { Spinner, formatDay } from "../ui";

/** useSearchParams needs a Suspense boundary for prerendering. */
export function PaymentMethodsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <PaymentMethods />
    </Suspense>
  );
}

/**
 * Metode pembayaran: the card or e-wallet saved at Xendit for auto-renew.
 * Linking happens on the Xendit page; Xendit sends the member back here with
 * ?linked=<id> (or ?canceled=<id>) and the list polls until the link settles.
 */
function PaymentMethods() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const { data, isLoading } = useSavedMethods();
  const unlink = useUnlinkSavedMethod();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (isLoading || !data) return <Spinner label={t("Loading payment methods…")} />;

  const active = activeMethod(data);
  const pending = data.methods.find((m) => m.status === "pending");
  const canceled = params.get("canceled") !== null && !active;

  const link = async () => {
    setBusy(true);
    setError("");
    try {
      const { redirect_url } = await linkSavedMethod();
      window.location.assign(redirect_url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Could not open the linking page."));
      setBusy(false);
    }
  };

  const remove = (m: SavedMethod) => {
    if (!window.confirm(t("Remove {label}? Auto-renew will send you an invoice instead.", { label: m.label ?? "" }))) return;
    setError("");
    unlink.mutate(m.id, {
      onError: (e) => setError(e instanceof ApiError ? e.message : t("Could not remove the payment method.")),
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-bold text-nh-muted">
        <ArrowLeft size={16} /> {t("Back")}
      </button>
      <h1 className="nh-display text-3xl">{t("Payment methods")}</h1>
      <p className="-mt-2 text-sm text-nh-muted">
        {t("Save a card or e-wallet so your membership renews without a checkout.")}
      </p>

      {!data.enabled ? (
        <div className="nh-card text-sm text-nh-muted">{t("Saved payment methods are not available yet.")}</div>
      ) : (
        <>
          {active ? (
            <MethodRow method={active}>
              <button
                type="button"
                className="text-sm font-bold text-nh-danger"
                disabled={unlink.isPending}
                onClick={() => remove(active)}
              >
                {t("Remove")}
              </button>
            </MethodRow>
          ) : pending && params.get("linked") === pending.id ? (
            <div className="nh-card flex items-center gap-3 text-sm">
              <Spinner />
              <span className="text-nh-muted">{t("Waiting for Xendit to confirm your payment method…")}</span>
            </div>
          ) : (
            <>
              {canceled ? <p className="text-sm font-bold text-nh-muted">{t("Linking was canceled.")}</p> : null}
              <button type="button" className="nh-btn-brand" disabled={busy} onClick={() => void link()}>
                {t("Link a card or e-wallet")}
              </button>
            </>
          )}
          <p className="flex items-start gap-2 text-xs text-nh-muted">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" />
            {t("You enter your card or e-wallet on Xendit's secure page. NüHabit keeps only a masked label.")}
          </p>
        </>
      )}
      {error ? <p className="text-sm font-bold text-nh-danger">{error}</p> : null}
    </div>
  );
}

function MethodRow({ method, children }: { method: SavedMethod; children: ReactNode }) {
  const t = useT();
  const Icon = method.type === "card" ? CreditCard : Wallet;
  return (
    <div className="nh-card flex items-center gap-3 !py-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-nh-ink-soft text-white">
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-extrabold">{method.label ?? t("Saved method")}</span>
        <span className="block text-xs text-nh-muted">
          {method.linked_at ? `${t("Linked")} ${formatDay(method.linked_at)}` : t("Saved method")}
          {method.simulated ? ` · ${t("Demo mode")}` : ""}
        </span>
      </span>
      {children}
    </div>
  );
}
