"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Camera,
  CheckCircle2,
  ChevronRight,
  Coins,
  CreditCard,
  ImageIcon,
  Loader2,
  QrCode,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UserRound,
  WalletCards,
} from "lucide-react";

type Step = "packages" | "member" | "payment" | "ready";
type PaymentMethod = "qris" | "ark_coin";

type PackageItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  xp: number;
  duration: string;
  prints: string;
  accent: string;
  image: string;
};

const packages: PackageItem[] = [
  {
    id: "pb-basic",
    name: "Classic Strip",
    description: "Single session dengan 4 pose dan 1 print strip.",
    price: 45000,
    xp: 100,
    duration: "5 menit",
    prints: "1 print",
    accent: "bg-rose-500",
    image: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: "pb-plus",
    name: "Studio Memory",
    description: "Session favorit untuk couple atau group kecil.",
    price: 75000,
    xp: 180,
    duration: "8 menit",
    prints: "2 print",
    accent: "bg-emerald-500",
    image: "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: "pb-premium",
    name: "Collector Set",
    description: "Lebih banyak pose, print, dan prioritas template event.",
    price: 125000,
    xp: 320,
    duration: "12 menit",
    prints: "4 print",
    accent: "bg-amber-500",
    image: "https://images.unsplash.com/photo-1502982720700-bfff97f2ecac?auto=format&fit=crop&w=900&q=80",
  },
];

const steps: { id: Step; label: string }[] = [
  { id: "packages", label: "Paket" },
  { id: "member", label: "Member" },
  { id: "payment", label: "Payment" },
  { id: "ready", label: "Ready" },
];

const currencyFormat = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const numberFormat = new Intl.NumberFormat("id-ID");

function formatCurrency(value: number) {
  return currencyFormat.format(value);
}

function formatNumber(value: number) {
  return numberFormat.format(value);
}

export default function PhotoboothSelfServicePage() {
  const [step, setStep] = useState<Step>("packages");
  const [selectedPackageId, setSelectedPackageId] = useState(packages[0].id);
  const [phone, setPhone] = useState("081234567894");
  const [customerName, setCustomerName] = useState("H. Abdullah Trading");
  const [asGuest, setAsGuest] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("qris");
  const [processing, setProcessing] = useState(false);

  const selectedPackage = useMemo(
    () => packages.find((item) => item.id === selectedPackageId) ?? packages[0],
    [selectedPackageId]
  );
  const arkBalance = 1500;
  const arkCoinPrice = Math.ceil(selectedPackage.price / 1000);
  const canUseArkCoin = arkBalance >= arkCoinPrice;
  const activeIndex = steps.findIndex((item) => item.id === step);

  function goNext() {
    if (step === "packages") setStep("member");
    if (step === "member") setStep("payment");
  }

  function goBack() {
    if (step === "member") setStep("packages");
    if (step === "payment") setStep("member");
    if (step === "ready") setStep("payment");
  }

  function resetFlow() {
    setStep("packages");
    setProcessing(false);
    setPaymentMethod("qris");
  }

  async function handlePay() {
    setProcessing(true);
    await new Promise((resolve) => setTimeout(resolve, 900));
    setProcessing(false);
    setStep("ready");
  }

  return (
    <main className="min-h-screen bg-[#f7f3ec] text-pink-950">
      <div className="grid min-h-screen lg:grid-cols-[1fr_420px]">
        <section className="flex min-h-screen flex-col">
          <header className="flex items-center justify-between border-b border-pink-200 bg-white/80 px-5 py-4 backdrop-blur md:px-8">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-lg bg-pink-600 text-white">
                <Camera className="size-5" />
              </div>
              <div>
                <h1 className="text-lg font-semibold tracking-normal">ARK Photobooth</h1>
                <p className="text-sm text-neutral-500">Self-service kiosk</p>
              </div>
            </div>
            <button
              type="button"
              onClick={resetFlow}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-4 text-sm font-semibold text-pink-800 shadow-sm transition hover:bg-pink-50"
            >
              <RotateCcw className="size-4" />
              Reset
            </button>
          </header>

          <div className="border-b border-pink-200 bg-[#fffaf1] px-5 py-4 md:px-8">
            <div className="grid gap-2 sm:grid-cols-4">
              {steps.map((item, index) => {
                const isActive = item.id === step;
                const isDone = index < activeIndex;
                return (
                  <div
                    key={item.id}
                    className={`flex h-11 items-center gap-3 rounded-md border px-3 text-sm font-semibold ${
                      isActive
                        ? "border-pink-600 bg-pink-600 text-white"
                        : isDone
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-neutral-200 bg-white text-neutral-500"
                    }`}
                  >
                    <span className="flex size-6 items-center justify-center rounded-full bg-current/10 text-xs">
                      {isDone ? <CheckCircle2 className="size-4" /> : index + 1}
                    </span>
                    {item.label}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex-1 px-5 py-6 md:px-8">
            {step === "packages" && (
              <section className="mx-auto max-w-6xl">
                <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h2 className="text-3xl font-semibold tracking-normal text-pink-950 md:text-4xl">
                      Pilih paket photobooth
                    </h2>
                    <p className="mt-2 max-w-2xl text-base text-neutral-600">
                      Pilih satu paket, lanjutkan ke member, lalu bayar dengan QRIS atau ARK Coin.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-pink-800">
                    <Sparkles className="size-4 text-rose-500" />
                    XP setelah foto selesai
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-3">
                  {packages.map((item) => {
                    const selected = item.id === selectedPackage.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedPackageId(item.id)}
                        className={`group overflow-hidden rounded-lg border bg-white text-left shadow-sm transition ${
                          selected ? "border-pink-600 ring-2 ring-pink-600/15" : "border-neutral-200 hover:border-pink-300"
                        }`}
                      >
                        <div
                          className="h-48 bg-cover bg-center"
                          style={{ backgroundImage: `url(${item.image})` }}
                        />
                        <div className="p-4">
                          <div className="mb-3 flex items-start justify-between gap-3">
                            <div>
                              <div className="text-xl font-semibold text-pink-950">{item.name}</div>
                              <div className="mt-1 text-sm leading-6 text-neutral-600">{item.description}</div>
                            </div>
                            <span className={`mt-1 size-3 rounded-full ${item.accent}`} />
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-sm">
                            <Metric label="Harga" value={formatCurrency(item.price)} />
                            <Metric label="XP" value={`+${formatNumber(item.xp)}`} />
                            <Metric label="Print" value={item.prints} />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {step === "member" && (
              <section className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[1fr_0.85fr]">
                <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-3 border-b border-neutral-100 pb-4">
                    <div className="flex size-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                      <UserRound className="size-5" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-semibold tracking-normal">Member lookup</h2>
                      <p className="text-sm text-neutral-500">Nomor HP, tap member card, atau guest checkout.</p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="text-sm font-semibold text-neutral-600">Nomor HP</span>
                      <input
                        value={phone}
                        onChange={(event) => {
                          setPhone(event.target.value);
                          setAsGuest(false);
                        }}
                        className="mt-2 h-14 w-full rounded-md border border-neutral-300 bg-white px-4 text-lg font-semibold text-pink-950 outline-none transition focus:border-pink-600 focus:ring-4 focus:ring-pink-600/15"
                        placeholder="08xxxxxxxxxx"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-neutral-600">Nama</span>
                      <input
                        value={customerName}
                        onChange={(event) => {
                          setCustomerName(event.target.value);
                          setAsGuest(false);
                        }}
                        className="mt-2 h-14 w-full rounded-md border border-neutral-300 bg-white px-4 text-lg font-semibold text-pink-950 outline-none transition focus:border-pink-600 focus:ring-4 focus:ring-pink-600/15"
                        placeholder="Nama customer"
                      />
                    </label>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <button
                      type="button"
                      className="flex h-16 items-center justify-center gap-3 rounded-md border border-neutral-300 bg-pink-600 px-4 text-base font-semibold text-white shadow-sm transition hover:bg-pink-700"
                    >
                      <CreditCard className="size-5" />
                      Tap Member Card
                    </button>
                    <button
                      type="button"
                      onClick={() => setAsGuest(true)}
                      className={`flex h-16 items-center justify-center gap-3 rounded-md border px-4 text-base font-semibold shadow-sm transition ${
                        asGuest
                          ? "border-amber-300 bg-amber-50 text-amber-900"
                          : "border-neutral-300 bg-white text-pink-900 hover:bg-pink-50"
                      }`}
                    >
                      <UserRound className="size-5" />
                      Continue as Guest
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border border-neutral-200 bg-pink-950 p-5 text-white shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex size-11 items-center justify-center rounded-lg bg-white/10">
                      <BadgeCheck className="size-5 text-emerald-300" />
                    </div>
                    <div>
                      <div className="text-sm text-white/50">Member preview</div>
                      <div className="text-xl font-semibold">{asGuest ? "Guest Customer" : customerName || "Customer"}</div>
                    </div>
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <DarkMetric label="Tier" value={asGuest ? "Guest" : "Bronze"} />
                    <DarkMetric label="Current XP" value={asGuest ? "0" : "1.500"} />
                    <DarkMetric label="ARK Coin" value={asGuest ? "0" : formatNumber(arkBalance)} />
                    <DarkMetric label="Earned" value={`+${formatNumber(selectedPackage.xp)} XP`} />
                  </div>
                </div>
              </section>
            )}

            {step === "payment" && (
              <section className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[1fr_0.9fr]">
                <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-3 border-b border-neutral-100 pb-4">
                    <div className="flex size-11 items-center justify-center rounded-lg bg-rose-50 text-rose-700">
                      <WalletCards className="size-5" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-semibold tracking-normal">Pilih payment</h2>
                      <p className="text-sm text-neutral-500">UI mock untuk QRIS dan ARK Coin.</p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <PaymentOption
                      active={paymentMethod === "qris"}
                      title="QRIS"
                      description="Generate QR dan tunggu status paid."
                      icon={QrCode}
                      onClick={() => setPaymentMethod("qris")}
                    />
                    <PaymentOption
                      active={paymentMethod === "ark_coin"}
                      title="ARK Coin"
                      description={canUseArkCoin ? `${formatNumber(arkCoinPrice)} coin akan dipakai.` : "Balance belum cukup."}
                      icon={Coins}
                      onClick={() => setPaymentMethod("ark_coin")}
                    />
                  </div>

                  {paymentMethod === "qris" ? (
                    <div className="mt-5 flex flex-col items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 p-6 text-center">
                      <div className="flex size-40 items-center justify-center rounded-lg border border-neutral-300 bg-white">
                        <QrCode className="size-24 text-pink-950" />
                      </div>
                      <div className="mt-4 text-sm font-semibold text-pink-800">QRIS Sandbox Preview</div>
                    </div>
                  ) : (
                    <div className="mt-5 rounded-lg border border-neutral-200 bg-amber-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-amber-950">ARK Coin Balance</div>
                          <div className="mt-1 text-3xl font-semibold text-amber-950">{formatNumber(arkBalance)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold text-amber-800">Dibutuhkan</div>
                          <div className="mt-1 text-2xl font-semibold text-amber-950">{formatNumber(arkCoinPrice)}</div>
                        </div>
                      </div>
                      {!canUseArkCoin && (
                        <div className="mt-3 rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700">
                          ARK Coin belum cukup untuk paket ini.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <OrderSummary selectedPackage={selectedPackage} paymentMethod={paymentMethod} />
              </section>
            )}

            {step === "ready" && (
              <section className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
                  <div className="flex size-16 items-center justify-center rounded-lg bg-emerald-600 text-white">
                    <CheckCircle2 className="size-8" />
                  </div>
                  <h2 className="mt-5 text-3xl font-semibold tracking-normal text-emerald-950">
                    Session ready
                  </h2>
                  <p className="mt-2 text-base leading-7 text-emerald-800">
                    Payment sukses. Nanti di integrasi partner, layar ini muncul setelah vendor menerima payment success dan membuat session photobooth.
                  </p>
                  <div className="mt-5 rounded-md border border-emerald-200 bg-white p-4">
                    <div className="text-sm font-semibold text-neutral-500">Session Token</div>
                    <div className="mt-1 break-all text-xl font-semibold text-pink-950">PB-DEMO-20260522-0001</div>
                  </div>
                </div>

                <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
                  <div
                    className="h-64 bg-cover bg-center"
                    style={{ backgroundImage: `url(${selectedPackage.image})` }}
                  />
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold text-neutral-500">Selected package</div>
                        <div className="mt-1 text-2xl font-semibold text-pink-950">{selectedPackage.name}</div>
                      </div>
                      <div className="rounded-md bg-pink-600 px-3 py-2 text-sm font-semibold text-white">
                        +{formatNumber(selectedPackage.xp)} XP
                      </div>
                    </div>
                    <div className="mt-5 grid gap-3 md:grid-cols-3">
                      <Metric label="Payment" value={paymentMethod === "qris" ? "QRIS" : "ARK Coin"} />
                      <Metric label="Duration" value={selectedPackage.duration} />
                      <Metric label="Print" value={selectedPackage.prints} />
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>

          <footer className="border-t border-pink-200 bg-white px-5 py-4 md:px-8">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
              <button
                type="button"
                onClick={goBack}
                disabled={step === "packages"}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-5 text-base font-semibold text-pink-900 shadow-sm transition hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowLeft className="size-5" />
                Back
              </button>

              {step === "payment" ? (
                <button
                  type="button"
                  onClick={() => void handlePay()}
                  disabled={processing || (paymentMethod === "ark_coin" && !canUseArkCoin)}
                  className="inline-flex h-12 min-w-44 items-center justify-center gap-2 rounded-md bg-pink-600 px-5 text-base font-semibold text-white shadow-sm transition hover:bg-pink-700 disabled:cursor-not-allowed disabled:bg-pink-200"
                >
                  {processing ? <Loader2 className="size-5 animate-spin" /> : <CreditCard className="size-5" />}
                  {processing ? "Processing" : "Pay Now"}
                </button>
              ) : step === "ready" ? (
                <button
                  type="button"
                  onClick={resetFlow}
                  className="inline-flex h-12 min-w-44 items-center justify-center gap-2 rounded-md bg-pink-600 px-5 text-base font-semibold text-white shadow-sm transition hover:bg-pink-700"
                >
                  New Session
                </button>
              ) : (
                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex h-12 min-w-44 items-center justify-center gap-2 rounded-md bg-pink-600 px-5 text-base font-semibold text-white shadow-sm transition hover:bg-pink-700"
                >
                  Continue
                  <ChevronRight className="size-5" />
                </button>
              )}
            </div>
          </footer>
        </section>

        <aside className="hidden min-h-screen border-l border-pink-200 bg-pink-600 p-6 text-white lg:flex lg:flex-col">
          <div
            className="min-h-72 rounded-lg bg-cover bg-center"
            style={{ backgroundImage: `url(${selectedPackage.image})` }}
          />
          <div className="mt-6">
            <div className="text-sm font-semibold text-white/50">Current order</div>
            <h2 className="mt-2 text-3xl font-semibold tracking-normal">{selectedPackage.name}</h2>
            <p className="mt-3 leading-7 text-white/65">{selectedPackage.description}</p>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <DarkMetric label="Price" value={formatCurrency(selectedPackage.price)} />
            <DarkMetric label="XP" value={`+${formatNumber(selectedPackage.xp)}`} />
            <DarkMetric label="Duration" value={selectedPackage.duration} />
            <DarkMetric label="Print" value={selectedPackage.prints} />
          </div>
          <div className="mt-auto rounded-lg border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-3">
              <ShieldCheck className="size-5 text-emerald-300" />
              <div>
                <div className="text-sm font-semibold">Partner integration pending</div>
                <div className="mt-1 text-xs leading-5 text-white/50">
                  Payment dispatch dan callback XP akan disambungkan setelah kontrak partner final.
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
      <div className="text-xs font-semibold text-neutral-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-pink-950">{value}</div>
    </div>
  );
}

function DarkMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/5 px-3 py-3">
      <div className="text-xs font-semibold text-white/45">{label}</div>
      <div className="mt-1 truncate text-base font-semibold text-white">{value}</div>
    </div>
  );
}

function PaymentOption({
  active,
  title,
  description,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  icon: typeof QrCode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-4 text-left shadow-sm transition ${
        active ? "border-pink-600 bg-pink-600 text-white" : "border-neutral-200 bg-white text-pink-950 hover:border-pink-300"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`flex size-11 items-center justify-center rounded-lg ${active ? "bg-white/10" : "bg-pink-50"}`}>
          <Icon className="size-5" />
        </div>
        <div>
          <div className="text-lg font-semibold">{title}</div>
          <div className={`mt-1 text-sm ${active ? "text-white/60" : "text-neutral-500"}`}>{description}</div>
        </div>
      </div>
    </button>
  );
}

function OrderSummary({ selectedPackage, paymentMethod }: { selectedPackage: PackageItem; paymentMethod: PaymentMethod }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3 border-b border-neutral-100 pb-4">
        <div className="flex size-11 items-center justify-center rounded-lg bg-pink-50 text-pink-900">
          <ImageIcon className="size-5" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-normal">Order summary</h2>
          <p className="text-sm text-neutral-500">Photobooth session preview.</p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-semibold text-pink-950">{selectedPackage.name}</div>
            <div className="mt-1 text-sm text-neutral-500">{selectedPackage.duration} · {selectedPackage.prints}</div>
          </div>
          <div className="text-right text-lg font-semibold text-pink-950">{formatCurrency(selectedPackage.price)}</div>
        </div>
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
          XP akan diberikan setelah callback partner sukses: +{formatNumber(selectedPackage.xp)}
        </div>
        <div className="flex items-center justify-between border-t border-neutral-100 pt-4">
          <div className="text-sm font-semibold text-neutral-500">Payment method</div>
          <div className="text-sm font-semibold text-pink-950">{paymentMethod === "qris" ? "QRIS" : "ARK Coin"}</div>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold text-pink-950">Total</div>
          <div className="text-3xl font-semibold text-pink-950">{formatCurrency(selectedPackage.price)}</div>
        </div>
      </div>
    </div>
  );
}
