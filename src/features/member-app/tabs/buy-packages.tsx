"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Building2, CheckCircle2, Copy, CreditCard, FlaskConical, Loader2, QrCode } from "lucide-react";
import { useMember } from "../member-app";
import { memberFetch, rupiah } from "../lib";
import { Card, CenterSpinner, Notice, PillButton, SectionTitle, Sheet, Tag } from "../ui";

interface ShopProduct {
  id: string;
  name: string;
  description: string | null;
  category: string;
  class_credits: number;
  pt_credits: number;
  facility_access: boolean;
  validity_days: number;
  price: number;
}

type Method = "qris" | "va" | "card";

interface PaymentOptions {
  methods: Method[];
  banks: string[];
  simulator: boolean;
}

interface Order {
  id: string;
  order_code: string;
  product_name: string;
  amount: number;
  status: "pending" | "paid" | "expired" | "cancelled";
  payment_method: Method;
  qr_string: string | null;
  va_bank: string | null;
  va_number: string | null;
  card_last4: string | null;
  simulated: boolean;
  expires_at: string;
  pass_code: string | null;
}

const METHOD_INFO: Record<Method, { label: string; hint: string; icon: typeof QrCode }> = {
  qris: { label: "QRIS", hint: "Scan with any banking or e-wallet app", icon: QrCode },
  va: { label: "Virtual Account", hint: "Bank transfer via ATM or mobile banking", icon: Building2 },
  card: { label: "Credit card", hint: "Visa, Mastercard, JCB", icon: CreditCard },
};

const BANK_LABEL: Record<string, string> = { BCA: "BCA", BNI: "BNI", BRI: "BRI", MANDIRI: "Mandiri", PERMATA: "Permata" };

function contents(p: ShopProduct): string {
  const parts: string[] = [];
  if (p.class_credits > 0) parts.push(`${p.class_credits} ${p.class_credits === 1 ? "class" : "classes"}`);
  if (p.pt_credits > 0) parts.push(`${p.pt_credits} Personal Training`);
  if (p.facility_access) parts.push("facility access");
  return parts.join(" + ");
}

function countdown(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function BuyPackages() {
  const [products, setProducts] = useState<ShopProduct[] | null>(null);
  const [payment, setPayment] = useState<PaymentOptions>({ methods: [], banks: [], simulator: false });
  const [selected, setSelected] = useState<ShopProduct | null>(null);

  useEffect(() => {
    memberFetch<{ data: ShopProduct[]; payment?: PaymentOptions }>("/api/member-portal/studio/shop")
      .then((r) => {
        setProducts(r.data);
        if (r.payment) setPayment(r.payment);
      })
      .catch(() => setProducts([]));
  }, []);

  if (!products) return <CenterSpinner />;
  if (products.length === 0) return null;

  return (
    <section>
      <SectionTitle>Choose a pass</SectionTitle>
      <div className="space-y-2">
        {products.map((p) => (
          <Card key={p.id} onClick={() => setSelected(p)}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{p.name}</p>
                <p className="mt-0.5 text-xs text-nh-beige/60">
                  {contents(p)} · valid {p.validity_days} days
                </p>
              </div>
              <p className="shrink-0 font-display text-lg font-semibold tabular-nums text-nh-lime">{rupiah(p.price)}</p>
            </div>
          </Card>
        ))}
      </div>
      {payment.methods.length === 0 && <p className="mt-3 text-xs text-nh-beige/50">Online payment is coming soon — you can buy any pass at the front desk.</p>}
      {selected && <BuySheet product={selected} payment={payment} onClose={() => setSelected(null)} />}
    </section>
  );
}

function SimulatorNote() {
  return (
    <p className="flex items-start gap-2 rounded-2xl bg-nh-ochre/15 px-3 py-2 text-xs text-nh-lemon">
      <FlaskConical className="mt-0.5 size-3.5 shrink-0" /> Development mode — payments are simulated and no money is charged.
    </p>
  );
}

function BuySheet({ product: p, payment, onClose }: { product: ShopProduct; payment: PaymentOptions; onClose: () => void }) {
  const { refresh } = useMember();
  const [method, setMethod] = useState<Method>(payment.methods[0] ?? "qris");
  const [bank, setBank] = useState<string>(payment.banks[0] ?? "BCA");
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const refreshed = useRef(false);

  const onPaid = useCallback(
    async (o: Order) => {
      setOrder(o);
      if (o.status === "paid" && !refreshed.current) {
        refreshed.current = true;
        await refresh();
      }
    },
    [refresh]
  );

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const o = (await memberFetch<{ data: Order }>("/api/member-portal/studio/orders", { method: "POST", body: { product_id: p.id, method, bank: method === "va" ? bank : null } })).data;
      setOrder(o);
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the payment");
    } finally {
      setBusy(false);
    }
  }

  async function simulate() {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      await onPaid((await memberFetch<{ data: Order }>(`/api/member-portal/studio/orders/${order.id}/simulate-pay`, { method: "POST", body: {} })).data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }

  const poll = useCallback(
    async (id: string) => {
      try {
        await onPaid((await memberFetch<{ data: Order }>(`/api/member-portal/studio/orders/${id}`)).data);
      } catch {
        /* coba lagi di putaran berikut */
      }
    },
    [onPaid]
  );

  useEffect(() => {
    if (!order || order.status !== "pending") return;
    const t = setInterval(() => {
      setNow(Date.now());
      void poll(order.id);
    }, 4000);
    return () => clearInterval(t);
  }, [order, poll]);

  async function copyVa() {
    if (!order?.va_number) return;
    try {
      await navigator.clipboard.writeText(order.va_number);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard tidak tersedia */
    }
  }

  const secondsLeft = order ? Math.max(0, Math.floor((Date.parse(order.expires_at) - now) / 1000)) : 0;
  const expiresLabel = order ? new Date(order.expires_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }) : "";
  const bankName = (b: string | null) => BANK_LABEL[b ?? ""] ?? b ?? "bank";

  return (
    <Sheet open onClose={onClose} title={p.name}>
      {!order ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white/5 p-4">
            <p className="font-display text-3xl font-bold tabular-nums text-nh-lime">{rupiah(p.price)}</p>
            <p className="mt-1 text-sm text-nh-beige/80">{contents(p)}</p>
            <p className="text-sm text-nh-beige/60">Valid for {p.validity_days} days from today</p>
          </div>
          {p.description && <p className="text-sm leading-relaxed text-nh-beige/75">{p.description}</p>}

          {payment.methods.length === 0 ? (
            <Notice tone="error">Online payment isn&apos;t available yet. Please buy your pass at the front desk.</Notice>
          ) : (
            <>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-nh-beige/60">Payment method</p>
                <div className="space-y-2">
                  {payment.methods.map((m) => {
                    const info = METHOD_INFO[m];
                    const Icon = info.icon;
                    const active = m === method;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMethod(m)}
                        className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${active ? "border-nh-lime bg-nh-lime/10" : "border-white/10 bg-nh-jungle"}`}
                      >
                        <Icon className={`size-5 ${active ? "text-nh-lime" : "text-nh-beige/60"}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">{info.label}</span>
                          <span className="block text-xs text-nh-beige/55">{info.hint}</span>
                        </span>
                        <span className={`size-4 rounded-full border-2 ${active ? "border-nh-lime bg-nh-lime" : "border-white/30"}`} />
                      </button>
                    );
                  })}
                </div>
              </div>
              {method === "va" && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-nh-beige/60">Bank</p>
                  <div className="grid grid-cols-3 gap-2">
                    {payment.banks.map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setBank(b)}
                        className={`rounded-xl py-2.5 text-sm font-semibold ${b === bank ? "bg-nh-lime text-nh-forest" : "border border-white/10 bg-nh-jungle"}`}
                      >
                        {bankName(b)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {payment.simulator && <SimulatorNote />}
              {error && <Notice tone="error">{error}</Notice>}
              <PillButton className="w-full" disabled={busy} onClick={start}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {method === "card" ? "Continue to card payment" : method === "va" ? `Pay with ${bankName(bank)} Virtual Account` : "Pay with QRIS"}
              </PillButton>
            </>
          )}
        </div>
      ) : order.status === "paid" ? (
        <div className="space-y-4 py-4 text-center">
          <CheckCircle2 className="mx-auto size-14 text-nh-lime" />
          <p className="font-display text-2xl font-semibold">Your pass is active.</p>
          <p className="text-sm text-nh-beige/70">
            Paid {rupiah(order.amount)} via{" "}
            {order.payment_method === "va" ? `${bankName(order.va_bank)} Virtual Account` : order.payment_method === "card" ? `card •••• ${order.card_last4}` : "QRIS"}.
          </p>
          <p className="text-sm text-nh-beige/70">{order.pass_code ? `Pass code ${order.pass_code}. ` : ""}See you at your next session.</p>
          <PillButton className="w-full" onClick={onClose}>Done</PillButton>
        </div>
      ) : order.status === "pending" && secondsLeft > 0 ? (
        <div className="space-y-4">
          <p className="text-center font-display text-3xl font-bold tabular-nums">{rupiah(order.amount)}</p>

          {order.payment_method === "qris" && order.qr_string && (
            <div className="space-y-3 text-center">
              <div className="mx-auto w-fit rounded-3xl bg-white p-4">
                <QRCodeSVG value={order.qr_string} size={216} />
              </div>
              <p className="text-sm text-nh-beige/70">Scan this QRIS with your banking or e-wallet app.</p>
            </div>
          )}

          {order.payment_method === "va" && order.va_number && (
            <div className="space-y-3">
              <div className="rounded-2xl bg-white/5 p-4">
                <p className="text-xs uppercase tracking-wide text-nh-beige/60">{bankName(order.va_bank)} Virtual Account</p>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <p className="whitespace-nowrap font-display text-xl font-bold tracking-wide tabular-nums">{order.va_number.replace(/(\d{4})(?=\d)/g, "$1 ")}</p>
                  <button type="button" onClick={copyVa} className="flex shrink-0 items-center gap-1 rounded-full border border-white/15 px-3 py-1 text-xs">
                    <Copy className="size-3.5" /> {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="mt-2 text-xs text-nh-beige/60">Pay before {expiresLabel}</p>
              </div>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-nh-beige/75">
                <li>Open {bankName(order.va_bank)} mobile banking or go to an ATM.</li>
                <li>Choose Transfer → Virtual Account.</li>
                <li>Enter the number above and pay exactly {rupiah(order.amount)}.</li>
              </ol>
            </div>
          )}

          {order.payment_method === "card" && (
            <div className="space-y-3">
              <div className="rounded-2xl bg-gradient-to-br from-nh-everglade to-nh-forest p-4">
                <p className="text-xs text-nh-beige/60">{order.simulated ? "Test card" : "Card"}</p>
                <p className="mt-2 font-display text-xl tracking-widest">•••• •••• •••• {order.card_last4}</p>
                <p className="mt-1 text-xs text-nh-beige/60">Visa · secured payment</p>
              </div>
              {order.simulated && <p className="text-xs text-nh-beige/55">In development we use a test card — never enter a real card number here.</p>}
            </div>
          )}

          <div className="flex items-center justify-center gap-2 text-xs text-nh-beige/60">
            <Loader2 className="size-3.5 animate-spin" /> Waiting for payment · <Tag>{countdown(secondsLeft)}</Tag>
          </div>
          <p className="text-center text-[11px] text-nh-beige/40">{order.order_code}</p>

          {error && <Notice tone="error">{error}</Notice>}
          {order.simulated ? (
            <>
              <SimulatorNote />
              <PillButton className="w-full" disabled={busy} onClick={simulate}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {order.payment_method === "card" ? `Pay ${rupiah(order.amount)}` : "Simulate successful payment"}
              </PillButton>
            </>
          ) : (
            <PillButton variant="ghost" className="w-full" onClick={() => poll(order.id)}>I&apos;ve paid</PillButton>
          )}
        </div>
      ) : (
        <div className="space-y-4 text-center">
          <p className="font-display text-xl font-semibold">Payment time is up.</p>
          <p className="text-sm text-nh-beige/70">If you were already charged, your pass will activate automatically. Or start a new payment.</p>
          <PillButton className="w-full" disabled={busy} onClick={() => { setOrder(null); setError(null); }}>
            Start again
          </PillButton>
        </div>
      )}
    </Sheet>
  );
}
