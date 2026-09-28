"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bike, CheckCircle2, Clock, Loader2, RefreshCw, Utensils, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatRupiah } from "@/lib/table-order/menu";
import type { GofoodOrderStatus, MappedGofoodLine, UnmappedGofoodLine } from "@/lib/gobiz/types";

type GofoodOrder = {
  id: string;
  gofood_order_id: string;
  gofood_order_type: "delivery" | "pickup";
  status: GofoodOrderStatus;
  pos_order_id: string | null;
  pos_order_number: string | null;
  pos_queue_number: string | null;
  pos_status: string | null;
  order_total: number;
  customer_name: string | null;
  driver_name: string | null;
  pin: string | null;
  cutlery_requested: boolean;
  items: MappedGofoodLine[];
  unmapped_items: UnmappedGofoodLine[];
  awaiting_since: string | null;
  accepted_at: string | null;
  food_ready_at: string | null;
  cancel_reason: string | null;
  last_error: string | null;
  created_at: string;
};

type Meta = { configured: boolean; enabled: boolean; auto_accept: boolean; environment: string };

const POLL_MS = 5000;
const ACCEPT_WINDOW_MS = 3 * 60 * 1000;

const STATUS_LABEL: Record<GofoodOrderStatus, string> = {
  created: "Baru",
  awaiting_acceptance: "Menunggu diterima",
  accepted: "Diterima",
  rejected: "Ditolak",
  driver_otw_pickup: "Driver menuju outlet",
  driver_arrived: "Driver tiba",
  placed: "Diambil driver",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  error: "Error",
};

function statusTone(status: GofoodOrderStatus) {
  switch (status) {
    case "awaiting_acceptance":
    case "created":
      return "bg-amber-50 text-amber-700 ring-amber-200";
    case "accepted":
    case "driver_otw_pickup":
    case "driver_arrived":
    case "placed":
      return "bg-blue-50 text-blue-700 ring-blue-200";
    case "completed":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    default:
      return "bg-red-50 text-red-700 ring-red-200";
  }
}

const REJECT_REASONS = [
  { code: "ITEMS_OUT_OF_STOCK", label: "Menu habis" },
  { code: "HIGH_DEMAND", label: "Terlalu ramai" },
  { code: "RESTAURANT_CLOSED", label: "Outlet tutup" },
  { code: "OTHERS", label: "Lainnya" },
] as const;

async function api<T>(input: string, init?: RequestInit): Promise<{ data: T; meta?: Meta }> {
  const response = await fetch(input, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string; data?: T; meta?: Meta };
  if (!response.ok || json.success === false) throw new Error(json.error || `Gagal (${response.status})`);
  return { data: json.data as T, meta: json.meta };
}

function Countdown({ since }: { since: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  if (!since) return null;
  const remaining = ACCEPT_WINDOW_MS - (now - new Date(since).getTime());
  if (remaining <= 0) return <span className="text-xs font-semibold text-red-600">Batas terima lewat</span>;
  const m = Math.floor(remaining / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold ${remaining < 60000 ? "text-red-600" : "text-amber-700"}`}>
      <Clock className="h-3.5 w-3.5" /> {m}:{String(s).padStart(2, "0")}
    </span>
  );
}

/** Halaman POS → GoFood (EPIC-049): pantau & tindak order GoFood. */
export function GofoodOrdersPage() {
  const [orders, setOrders] = useState<GofoodOrder[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<{ id: string; code: (typeof REJECT_REASONS)[number]["code"]; description: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api<GofoodOrder[]>(`/api/pos/gofood/orders?status=${filter === "active" ? "active" : ""}&limit=100`);
      setOrders(result.data);
      if (result.meta) setMeta(result.meta);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    // Muat lewat timer (bukan sinkron di body effect) + polling berkala.
    const run = () => {
      void load();
    };
    const first = window.setTimeout(run, 0);
    const timer = window.setInterval(run, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);

  async function act(id: string, body: Record<string, unknown>, okMessage: string) {
    setBusy(id);
    try {
      await api(`/api/pos/gofood/orders/${id}`, { method: "POST", body: JSON.stringify(body) });
      toast.success(okMessage);
      setRejecting(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Aksi gagal");
    } finally {
      setBusy(null);
    }
  }

  const awaiting = orders.filter((o) => o.status === "awaiting_acceptance" || o.status === "created").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-900">
            <Bike className="h-6 w-6 text-emerald-600" /> GoFood
          </h1>
          <p className="text-sm text-gray-500">
            Order dari GoFood (GoBiz). {meta?.auto_accept ? "Auto-accept aktif." : "Terima dalam 3 menit atau GoFood membatalkannya."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-full bg-gray-100 p-1 text-sm font-semibold">
            {(["active", "all"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`h-8 rounded-full px-4 ${filter === value ? "bg-white shadow text-gray-900" : "text-gray-600"}`}
              >
                {value === "active" ? `Aktif${awaiting ? ` (${awaiting})` : ""}` : "Semua"}
              </button>
            ))}
          </div>
          <Button type="button" variant="outline" onClick={() => void load()} className="h-9">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {meta && !meta.configured && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            GoBiz belum dikonfigurasi. Isi kredensial di{" "}
            <Link href="/dashboard/settings/integrations" className="font-semibold underline">
              Settings → Integrasi → GoBiz
            </Link>
            , daftarkan webhook, lalu sinkron katalog.
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Memuat…
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center text-sm text-gray-500">
          Belum ada order GoFood {filter === "active" ? "aktif" : ""}.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {orders.map((order) => {
            const canAccept = order.status === "awaiting_acceptance" || order.status === "created";
            const canReject = canAccept || order.status === "accepted";
            const canReady = ["accepted", "driver_otw_pickup", "driver_arrived"].includes(order.status) && !order.food_ready_at;
            const isBusy = busy === order.id;
            return (
              <article key={order.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-base font-bold text-gray-900">{order.gofood_order_id}</span>
                      <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-gray-600">
                        {order.gofood_order_type}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {new Date(order.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                      {order.customer_name ? ` · ${order.customer_name}` : ""}
                      {order.pin ? ` · PIN ${order.pin}` : ""}
                      {order.driver_name ? ` · Driver: ${order.driver_name}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${statusTone(order.status)}`}>
                      {STATUS_LABEL[order.status]}
                    </span>
                    {canAccept && <Countdown since={order.awaiting_since || order.created_at} />}
                  </div>
                </div>

                <ul className="mt-3 divide-y divide-gray-100 text-sm">
                  {order.items.map((line, index) => (
                    <li key={`${line.product_id}-${index}`} className="flex justify-between py-1.5">
                      <span>
                        <b>{line.quantity}×</b> {line.product_name}
                        {line.variant_name ? <span className="text-gray-500"> · {line.variant_name}</span> : null}
                        {line.modifiers?.length ? (
                          <span className="block text-xs text-gray-500">+ {line.modifiers.map((m) => m.name).join(", ")}</span>
                        ) : null}
                        {line.notes ? <span className="block text-xs text-amber-700">“{line.notes}”</span> : null}
                      </span>
                      <span className="text-gray-700">{formatRupiah(line.unit_price * line.quantity)}</span>
                    </li>
                  ))}
                  {order.unmapped_items.map((line, index) => (
                    <li key={`u-${index}`} className="flex justify-between py-1.5 text-red-700">
                      <span>
                        <b>{line.quantity}×</b> {line.name} <span className="text-xs">(tidak ada di katalog POS — sinkron katalog)</span>
                      </span>
                      <span>{formatRupiah(line.price * line.quantity)}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
                  <div className="text-sm">
                    <span className="text-gray-500">Total </span>
                    <b className="text-gray-900">{formatRupiah(order.order_total)}</b>
                    {order.cutlery_requested && <span className="ml-2 text-xs text-gray-500">· minta alat makan</span>}
                    {order.pos_order_number && (
                      <span className="ml-2 text-xs text-gray-500">
                        · POS {order.pos_order_number}
                        {order.pos_queue_number ? ` / antrean ${order.pos_queue_number}` : ""}
                        {order.pos_status ? ` (${order.pos_status})` : ""}
                      </span>
                    )}
                    {order.food_ready_at && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> siap diambil
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canAccept && (
                      <Button type="button" onClick={() => act(order.id, { action: "accept" }, "Order diterima")} disabled={isBusy} className="h-9 bg-emerald-600 hover:bg-emerald-700">
                        {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Terima
                      </Button>
                    )}
                    {canReject && (
                      <Button type="button" variant="outline" onClick={() => setRejecting({ id: order.id, code: "ITEMS_OUT_OF_STOCK", description: "Menu sedang habis" })} disabled={isBusy} className="h-9 text-red-600">
                        <XCircle className="h-4 w-4" /> Tolak
                      </Button>
                    )}
                    {canReady && (
                      <Button type="button" variant="outline" onClick={() => act(order.id, { action: "ready" }, "GoFood diberi tahu: makanan siap")} disabled={isBusy} className="h-9">
                        <Utensils className="h-4 w-4" /> Siap diambil
                      </Button>
                    )}
                    {order.status === "accepted" && !order.pos_order_id && order.items.length > 0 && (
                      <Button type="button" variant="outline" onClick={() => act(order.id, { action: "create_pos_order" }, "Order POS dibuat")} disabled={isBusy} className="h-9">
                        Buat order POS
                      </Button>
                    )}
                  </div>
                </div>

                {order.last_error && (
                  <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">GoBiz: {order.last_error}</div>
                )}
                {order.cancel_reason && (order.status === "cancelled" || order.status === "rejected") && (
                  <div className="mt-2 text-xs text-gray-500">Alasan: {order.cancel_reason}</div>
                )}

                {rejecting?.id === order.id && (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3">
                    <div className="text-xs font-semibold text-red-800">Tolak order — alasan dikirim ke GoFood</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[180px_1fr_auto]">
                      <select
                        value={rejecting.code}
                        onChange={(event) => setRejecting({ ...rejecting, code: event.target.value as typeof rejecting.code })}
                        className="h-9 rounded-lg border border-red-200 bg-white px-2 text-sm"
                      >
                        {REJECT_REASONS.map((reason) => (
                          <option key={reason.code} value={reason.code}>
                            {reason.label}
                          </option>
                        ))}
                      </select>
                      <input
                        value={rejecting.description}
                        onChange={(event) => setRejecting({ ...rejecting, description: event.target.value })}
                        className="h-9 rounded-lg border border-red-200 bg-white px-3 text-sm"
                        placeholder="Keterangan (min. 3 karakter)"
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          onClick={() => act(order.id, { action: "reject", reason_code: rejecting.code, reason_description: rejecting.description }, "Order ditolak")}
                          disabled={isBusy || rejecting.description.trim().length < 3}
                          className="h-9 bg-red-600 hover:bg-red-700"
                        >
                          Kirim
                        </Button>
                        <Button type="button" variant="outline" onClick={() => setRejecting(null)} className="h-9">
                          Batal
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
