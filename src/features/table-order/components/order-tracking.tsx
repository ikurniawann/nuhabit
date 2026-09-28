"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Check, CheckCircle2, Clock, Download, Loader2, RefreshCw, XCircle } from "lucide-react";
import { QrisCard } from "@/components/pos/QrisCard";
import { formatRupiah } from "@/lib/table-order/menu";
import {
  isOrderActive,
  ORDER_PROGRESS_STEPS,
  orderProgressStep,
  orderStatusText,
  orderTypeText,
  paymentMethodText,
  paymentStatusText,
} from "@/lib/table-order/order-status";
import { fetchOrder, type OrderData } from "../api";

const POLL_UNPAID_MS = 5_000;
const POLL_ACTIVE_MS = 12_000;

/**
 * Layar setelah pesanan terkirim: nomor antrean, progres dapur, dan
 * pembayaran (QRIS ditampilkan di HP pemesan; status dicek berkala ke server
 * yang meneruskan ke Xendit & melunasi otomatis).
 */
export function OrderTracking({
  order: initialOrder,
  tableLabel,
  brandName,
  onOrderUpdate,
  onNewOrder,
  xpEnabled = true,
}: {
  xpEnabled?: boolean;
  order: OrderData;
  tableLabel: string;
  brandName: string;
  onOrderUpdate: (order: OrderData) => void;
  onNewOrder: () => void;
}) {
  const [order, setOrder] = useState(initialOrder);
  const [qris, setQris] = useState(initialOrder.qris);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qrCanvasRef = useRef<HTMLDivElement>(null);

  const unpaidQris = order.payment_flow === "qris" && order.payment_status === "unpaid";
  const active = isOrderActive(order.status);

  const refresh = useCallback(
    async (withQr: boolean) => {
      setRefreshing(true);
      try {
        const next = await fetchOrder(order.id, { qr: withQr });
        setOrder(next);
        if (next.qris?.qr_string) setQris(next.qris);
        onOrderUpdate(next);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal memperbarui status");
      } finally {
        setRefreshing(false);
      }
    },
    [order.id, onOrderUpdate]
  );

  // QR hilang setelah reload halaman → minta ulang ke server (sekali).
  const needQr = unpaidQris && !qris?.qr_string;
  useEffect(() => {
    if (!needQr) return;
    let cancelled = false;
    fetchOrder(order.id, { qr: true })
      .then((next) => {
        if (cancelled) return;
        setOrder(next);
        if (next.qris?.qr_string) setQris(next.qris);
        onOrderUpdate(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Gagal memuat QRIS");
      });
    return () => {
      cancelled = true;
    };
  }, [needQr, order.id, onOrderUpdate]);

  useEffect(() => {
    if (!active && !unpaidQris) return;
    const interval = window.setInterval(
      () => void refresh(false),
      unpaidQris ? POLL_UNPAID_MS : POLL_ACTIVE_MS
    );
    return () => window.clearInterval(interval);
  }, [active, unpaidQris, refresh]);

  function saveQrImage() {
    const canvas = qrCanvasRef.current?.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `qris-${order.order_number || order.id}.png`;
    link.click();
  }

  const step = orderProgressStep(order.status);
  const cancelled = step < 0;

  return (
    <div className="pb-28">
      <div className="bg-primary px-5 pb-16 pt-6 text-white">
        <div className="text-xs font-semibold uppercase tracking-wide text-white/70">{brandName}</div>
        <div className="mt-1 text-sm text-white/80">
          Meja {tableLabel} · {orderTypeText(order.order_type)}
        </div>
        <div className="mt-5 flex items-end justify-between">
          <div>
            <div className="text-xs text-white/70">Nomor antrean</div>
            <div className="text-5xl font-black leading-none">{order.queue_number || "—"}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-white/70">No. pesanan</div>
            <div className="text-sm font-bold">{order.order_number || order.id.slice(0, 8)}</div>
          </div>
        </div>
      </div>

      <div className="-mt-10 space-y-4 px-4">
        <section className="rounded-2xl bg-white p-4 shadow-md shadow-black/5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-gray-900">Status pesanan</div>
            <button
              type="button"
              onClick={() => void refresh(unpaidQris)}
              disabled={refreshing}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
            >
              <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Perbarui
            </button>
          </div>
          {cancelled ? (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              <XCircle className="size-4" /> {orderStatusText(order.status)}
            </div>
          ) : (
            <ol className="mt-4 flex items-start justify-between">
              {ORDER_PROGRESS_STEPS.map((item, index) => {
                const done = index < step;
                const current = index === step;
                return (
                  <li key={item.key} className="flex flex-1 flex-col items-center text-center">
                    <div className="flex w-full items-center">
                      <div className={`h-0.5 flex-1 ${index === 0 ? "bg-transparent" : done || current ? "bg-primary" : "bg-gray-200"}`} />
                      <div
                        className={`flex size-7 items-center justify-center rounded-full border-2 text-xs font-bold ${
                          done
                            ? "border-primary bg-primary text-white"
                            : current
                              ? "border-primary bg-white text-primary"
                              : "border-gray-200 bg-white text-gray-400"
                        }`}
                      >
                        {done ? <Check className="size-3.5" /> : index + 1}
                      </div>
                      <div className={`h-0.5 flex-1 ${index === ORDER_PROGRESS_STEPS.length - 1 ? "bg-transparent" : done ? "bg-primary" : "bg-gray-200"}`} />
                    </div>
                    <div className={`mt-1.5 text-[10px] font-semibold ${current ? "text-primary" : done ? "text-gray-700" : "text-gray-400"}`}>
                      {item.label}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="mt-3 text-sm text-gray-600">{orderStatusText(order.status)}</p>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-md shadow-black/5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-gray-900">Pembayaran</div>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                order.payment_status === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
              }`}
            >
              {paymentStatusText(order.payment_status)}
            </span>
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {paymentMethodText(order.payment_flow)} · {formatRupiah(order.total_amount)}
          </div>

          {order.payment_status === "paid" && (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
              <CheckCircle2 className="size-4" /> Pembayaran diterima — pesanan sedang diproses.
            </div>
          )}

          {unpaidQris && (
            <div className="mt-4">
              {qris?.qr_string ? (
                <div className="flex flex-col items-center">
                  <QrisCard qrString={qris.qr_string} merchantName={brandName} />
                  <div ref={qrCanvasRef} className="hidden">
                    <QRCodeCanvas value={qris.qr_string} size={512} marginSize={2} />
                  </div>
                  <div className="mt-3 flex w-full items-center justify-center gap-2 text-sm font-semibold text-amber-700">
                    <Loader2 className="size-4 animate-spin" /> Menunggu pembayaran…
                  </div>
                  <button
                    type="button"
                    onClick={saveQrImage}
                    className="mt-3 inline-flex h-10 items-center gap-2 rounded-full border border-gray-200 px-4 text-sm font-semibold text-gray-700"
                  >
                    <Download className="size-4" /> Simpan gambar QR
                  </button>
                  <p className="mt-3 text-center text-xs leading-relaxed text-gray-500">
                    Simpan gambar QR, lalu buka aplikasi pembayaran (GoPay/OVO/DANA/m-banking) dan
                    pilih <b>scan dari galeri</b>. Bisa juga minta teman memindai layar ini.
                    {qris.expires_at && (
                      <>
                        {" "}
                        Berlaku sampai{" "}
                        {new Date(qris.expires_at).toLocaleTimeString("id-ID", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        .
                      </>
                    )}
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-600">
                  <Loader2 className="size-4 animate-spin" /> Menyiapkan QRIS…
                </div>
              )}
            </div>
          )}

          {order.payment_flow === "cashier" && order.payment_status !== "paid" && (
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-700">
              <Clock className="mt-0.5 size-4 shrink-0 text-gray-500" />
              <span>
                Bayar di kasir dengan menyebutkan nomor antrean <b>{order.queue_number || order.order_number}</b>.
                {order.qris_error ? " (QRIS sempat gagal dibuat, pesanan tetap masuk.)" : ""}
              </span>
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-md shadow-black/5">
          <div className="text-sm font-bold text-gray-900">Rincian pesanan</div>
          <div className="mt-3 divide-y divide-gray-100">
            {order.items.map((item, index) => (
              <div key={item.id || index} className="flex items-start justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900">
                    {item.quantity}× {item.product_name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {item.variant_name ? `${item.variant_name} · ` : ""}
                    {item.kitchen_status ? kitchenStatusText(item.kitchen_status) : item.station}
                  </div>
                </div>
                <div className="shrink-0 font-semibold text-gray-900">{formatRupiah(item.total_amount)}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1.5 border-t border-gray-100 pt-3 text-sm text-gray-600">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="font-semibold text-gray-900">{formatRupiah(order.subtotal)}</span>
            </div>
            {order.breakdown.map((line) => (
              <div key={line.code} className="flex justify-between">
                <span>
                  {line.name}
                  {line.rate != null ? ` (${line.rate}%)` : ""}
                </span>
                <span className="font-semibold text-gray-900">{formatRupiah(line.amount)}</span>
              </div>
            ))}
            {xpEnabled && order.total_xp > 0 && (
              <div className="flex justify-between text-amber-600">
                <span>XP</span>
                <span className="font-semibold">+{order.total_xp} XP</span>
              </div>
            )}
            <div className="flex justify-between border-t border-gray-100 pt-2 text-base font-bold text-gray-900">
              <span>Total</span>
              <span>{formatRupiah(order.total_amount)}</span>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-100 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto max-w-md">
          <button
            type="button"
            onClick={onNewOrder}
            className="h-12 w-full rounded-xl border-2 border-primary text-sm font-bold text-primary"
          >
            Pesan lagi
          </button>
        </div>
      </div>
    </div>
  );
}

function kitchenStatusText(status: string) {
  switch (status) {
    case "preparing":
      return "Sedang disiapkan";
    case "ready":
      return "Siap";
    case "served":
      return "Sudah diantar";
    default:
      return "Menunggu dapur";
  }
}
