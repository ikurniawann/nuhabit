"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  Volume2,
  VolumeX,
  RefreshCw,
  Maximize2,
  Minimize2,
  Utensils,
  ShoppingBag,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { KDSOrder } from "@/lib/pos/kds-types";
import {
  activeQueueItems,
  itemIsReady,
  queueItemProgress,
} from "@/lib/pos/queue-board";
import { unlockQueueBoardSound, useQueueBoard } from "../queries";
import { todayWib } from "@/lib/pos/report-dates";

const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: "Dine In",
  takeaway: "Bungkus",
  pickup: "Ambil",
  delivery: "Delivery",
};

function getTodayRange() {
  // Samakan SSR (UTC) & browser: hari operasional Asia/Jakarta.
  const day = todayWib();
  const start = new Date(`${day}T00:00:00+07:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    dateFrom: start.toISOString(),
    dateTo: end.toISOString(),
  };
}

function formatClock(date: Date) {
  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function QueueCard({
  order,
  emphasis,
}: {
  order: KDSOrder;
  emphasis: "preparing" | "ready";
}) {
  const ready = emphasis === "ready";
  const items = activeQueueItems(order);
  const progress = queueItemProgress(order);
  // Panel siap diambil: utamakan (dan fokusatkan) item yang sudah siap diantar
  const displayItems = ready
    ? [...items.filter(itemIsReady), ...items.filter((i) => !itemIsReady(i))]
    : items;
  const visible = displayItems.slice(0, 5);
  const overflow = Math.max(0, displayItems.length - visible.length);

  return (
    <article
      className={cn(
        "rounded-2xl border p-4 sm:p-5",
        ready
          ? "border-emerald-400/40 bg-emerald-500/15 shadow-[0_0_24px_rgba(16,185,129,0.18)]"
          : progress.hasPartialReady
            ? "border-emerald-400/25 bg-white/5 ring-1 ring-emerald-400/20"
            : "border-white/10 bg-white/5"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p
          className={cn(
            "font-black tabular-nums leading-none tracking-tight",
            ready
              ? "text-6xl text-emerald-300 sm:text-7xl"
              : "text-5xl text-amber-200 sm:text-6xl"
          )}
        >
          {order.queue_number || "—"}
        </p>
        {ready ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/25 px-2.5 py-1 text-xs font-semibold text-emerald-200">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {progress.allReady
              ? "Semua siap"
              : `${progress.readyCount}/${progress.total} siap ambil`}
          </span>
        ) : progress.hasPartialReady ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {progress.readyCount}/{progress.total} siap
          </span>
        ) : null}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-sm text-white/60">
        {order.order_type === "dine_in" ? (
          <Utensils className="h-3.5 w-3.5" />
        ) : (
          <ShoppingBag className="h-3.5 w-3.5" />
        )}
        <span>{ORDER_TYPE_LABELS[order.order_type] || order.order_type}</span>
        {(order.table_label || order.table_id) && (
          <span>· {order.table_label || `Meja ${String(order.table_id).slice(0, 6)}`}</span>
        )}
      </p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {visible.map((item) => {
          const itemReady = itemIsReady(item);
          // Di panel siap: item belum ready ditampilkan redup (masih dimasak)
          if (ready && !itemReady) {
            return (
              <li
                key={item.id}
                className="flex items-center justify-between gap-2 truncate rounded-lg px-2 py-1 text-white/40"
              >
                <span className="min-w-0 truncate">
                  <span className="font-semibold text-white/30">{item.quantity}×</span>{" "}
                  {item.product_name}
                </span>
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-amber-200/50">
                  Proses
                </span>
              </li>
            );
          }
          return (
            <li
              key={item.id}
              className={cn(
                "flex items-center justify-between gap-2 truncate rounded-lg px-2 py-1",
                itemReady
                  ? "bg-emerald-500/15 text-emerald-100"
                  : "text-white/80"
              )}
            >
              <span className="min-w-0 truncate">
                <span
                  className={cn(
                    "font-semibold",
                    itemReady ? "text-emerald-300/80" : "text-white/50"
                  )}
                >
                  {item.quantity}×
                </span>{" "}
                {item.product_name}
              </span>
              {itemReady ? (
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                  Siap
                </span>
              ) : (
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-amber-200/70">
                  Proses
                </span>
              )}
            </li>
          );
        })}
        {overflow > 0 ? (
          <li className="px-2 text-xs text-white/40">+{overflow} item lain</li>
        ) : null}
      </ul>
    </article>
  );
}

type QueueBoardPageProps = {
  venueName?: string | null;
};

const subscribeClock = (onTick: () => void) => {
  const timer = window.setInterval(onTick, 1000);
  return () => window.clearInterval(timer);
};
const clockSeconds = () => Math.floor(Date.now() / 1000);

/** Jam dinding per detik; null saat SSR supaya tidak ada selisih hidrasi. */
function useClock(): Date | null {
  const seconds = useSyncExternalStore(subscribeClock, clockSeconds, () => null);
  return seconds === null ? null : new Date(seconds * 1000);
}

export function QueueBoardPage({ venueName }: QueueBoardPageProps) {
  const todayRange = getTodayRange();
  // Jam hidup: jangan render waktu di SSR — `new Date()` / locale beda → hydration mismatch.
  const now = useClock();
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false);
  const { preparing, ready, loading, error, soundEnabled, setSoundEnabled, refresh } =
    useQueueBoard({
      dateFrom: todayRange.dateFrom,
      dateTo: todayRange.dateTo,
      pollInterval: 3000,
    });

  useEffect(() => {
    const sync = () => setIsBrowserFullscreen(Boolean(document.fullscreenElement));
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleBrowserFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await document.documentElement.requestFullscreen();
    } catch {
      toast.error("Browser menolak layar penuh. Coba klik lagi, atau tekan F11.");
    }
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-slate-950 text-white">
      <header className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-white/40">Antrian</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {venueName || "Ambil pesanan Anda"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <p
            className="mr-2 hidden min-w-[7.5rem] text-right font-mono text-xl tabular-nums text-white/70 sm:block"
            suppressHydrationWarning
          >
            {now ? formatClock(now) : "\u00A0"}
          </p>
          <Button
            size="icon"
            variant="ghost"
            className="text-white/60 hover:text-white"
            onClick={() => {
              setSoundEnabled((value) => {
                const next = !value;
                if (next) unlockQueueBoardSound();
                return next;
              });
            }}
            title={soundEnabled ? "Matikan bunyi" : "Nyalakan bunyi"}
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="text-white/60 hover:text-white"
            onClick={() => void refresh()}
            title="Muat ulang"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="text-white/60 hover:text-white"
            onClick={() => void toggleBrowserFullscreen()}
            title={isBrowserFullscreen ? "Keluar layar penuh" : "Layar penuh"}
          >
            {isBrowserFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {error ? (
        <div className="border-b border-red-500/30 bg-red-500/10 px-6 py-2 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-2">
        <section className="flex min-h-0 flex-col rounded-3xl border border-amber-400/20 bg-amber-500/5 p-4">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-widest text-amber-200/80">
                Sedang disiapkan
              </p>
              <p className="text-white/50">{preparing.length} antrian</p>
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {preparing.length === 0 ? (
              <p className="py-16 text-center text-white/35">Belum ada antrian</p>
            ) : (
              preparing.map((order) => (
                <QueueCard
                  key={order.checkout_id || order.id}
                  order={order}
                  emphasis="preparing"
                />
              ))
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-col rounded-3xl border border-emerald-400/25 bg-emerald-500/10 p-4">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-widest text-emerald-200">
                Siap diambil
              </p>
              <p className="text-white/50">{ready.length} antrian</p>
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {ready.length === 0 ? (
              <p className="py-16 text-center text-white/35">Belum ada yang siap</p>
            ) : (
              ready.map((order) => (
                <QueueCard
                  key={order.checkout_id || order.id}
                  order={order}
                  emphasis="ready"
                />
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
