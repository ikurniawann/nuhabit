"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, Loader2 } from "lucide-react";
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

interface Order {
  id: string;
  order_code: string;
  product_name: string;
  amount: number;
  status: "pending" | "paid" | "expired" | "cancelled";
  qr_string: string | null;
  expires_at: string;
  pass_code: string | null;
}

function contents(p: ShopProduct): string {
  const parts: string[] = [];
  if (p.class_credits > 0) parts.push(`${p.class_credits} ${p.class_credits === 1 ? "class" : "classes"}`);
  if (p.pt_credits > 0) parts.push(`${p.pt_credits} Personal Training`);
  if (p.facility_access) parts.push("facility access");
  return parts.join(" + ");
}

export function BuyPackages() {
  const [products, setProducts] = useState<ShopProduct[] | null>(null);
  const [selected, setSelected] = useState<ShopProduct | null>(null);

  useEffect(() => {
    memberFetch<{ data: ShopProduct[] }>("/api/member-portal/studio/shop")
      .then((r) => setProducts(r.data))
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
      {selected && <BuySheet product={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}

function BuySheet({ product: p, onClose }: { product: ShopProduct; onClose: () => void }) {
  const { refresh } = useMember();
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const refreshed = useRef(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setOrder((await memberFetch<{ data: Order }>("/api/member-portal/studio/orders", { method: "POST", body: { product_id: p.id } })).data);
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the payment");
    } finally {
      setBusy(false);
    }
  }

  const poll = useCallback(async (id: string) => {
    try {
      const o = (await memberFetch<{ data: Order }>(`/api/member-portal/studio/orders/${id}`)).data;
      setOrder(o);
      if (o.status === "paid" && !refreshed.current) {
        refreshed.current = true;
        await refresh();
      }
    } catch {
      /* coba lagi di putaran berikut */
    }
  }, [refresh]);

  useEffect(() => {
    if (!order || order.status !== "pending") return;
    const t = setInterval(() => {
      setNow(Date.now());
      void poll(order.id);
    }, 4000);
    return () => clearInterval(t);
  }, [order, poll]);

  const secondsLeft = order ? Math.max(0, Math.floor((Date.parse(order.expires_at) - now) / 1000)) : 0;

  return (
    <Sheet open onClose={onClose} title={p.name}>
      {!order ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white/5 p-4">
            <p className="font-display text-3xl font-bold text-nh-lime tabular-nums">{rupiah(p.price)}</p>
            <p className="mt-1 text-sm text-nh-beige/80">{contents(p)}</p>
            <p className="text-sm text-nh-beige/60">Valid for {p.validity_days} days from today</p>
          </div>
          {p.description && <p className="text-sm leading-relaxed text-nh-beige/75">{p.description}</p>}
          {error && <Notice tone="error">{error}</Notice>}
          <PillButton className="w-full" disabled={busy} onClick={start}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Pay with QRIS
          </PillButton>
          <p className="text-center text-xs text-nh-beige/50">Pay from any banking or e-wallet app.</p>
        </div>
      ) : order.status === "paid" ? (
        <div className="space-y-4 py-4 text-center">
          <CheckCircle2 className="mx-auto size-14 text-nh-lime" />
          <p className="font-display text-2xl font-semibold">Your pass is active.</p>
          <p className="text-sm text-nh-beige/70">
            {order.pass_code ? `Pass code ${order.pass_code}. ` : ""}See you at your next session.
          </p>
          <PillButton className="w-full" onClick={onClose}>Done</PillButton>
        </div>
      ) : order.status === "pending" && order.qr_string && secondsLeft > 0 ? (
        <div className="space-y-4 text-center">
          <p className="font-display text-3xl font-bold tabular-nums">{rupiah(order.amount)}</p>
          <div className="mx-auto w-fit rounded-3xl bg-white p-4">
            <QRCodeSVG value={order.qr_string} size={224} />
          </div>
          <p className="text-sm text-nh-beige/70">Scan this QRIS with your banking or e-wallet app.</p>
          <div className="flex items-center justify-center gap-2 text-xs text-nh-beige/60">
            <Loader2 className="size-3.5 animate-spin" /> Waiting for payment ·{" "}
            <Tag>
              {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
            </Tag>
          </div>
          <p className="text-[11px] text-nh-beige/40">{order.order_code}</p>
          <PillButton variant="ghost" className="w-full" onClick={() => poll(order.id)}>I've paid</PillButton>
        </div>
      ) : (
        <div className="space-y-4 text-center">
          <p className="font-display text-xl font-semibold">Payment time is up.</p>
          <p className="text-sm text-nh-beige/70">If you were already charged, your pass will activate automatically. Or create a new QRIS.</p>
          <PillButton className="w-full" disabled={busy} onClick={() => { setOrder(null); void start(); }}>
            Create new QRIS
          </PillButton>
        </div>
      )}
    </Sheet>
  );
}
