"use client";

import { useState } from "react";
import Link from "next/link";
import { BellRing, Maximize2, X } from "lucide-react";
import { unlockKdsSound } from "@/features/pos/kds/queries";
import { cn } from "@/lib/utils";
import { SelfOrderQueue, useIncomingSelfOrders } from "./self-order-queue";

/**
 * Gelembung notifikasi pesanan self-order baru di POS → Orders (owner
 * 2026-10-01): jumlah pesanan menunggu + panel daftar dgn tombol "Dibuat".
 */
export function SelfOrderBubble() {
  const query = useIncomingSelfOrders();
  const [open, setOpen] = useState(false);
  const count = query.data?.length ?? 0;

  return (
    <>
      {open ? (
        <div className="fixed bottom-24 right-4 z-40 flex max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 shadow-2xl">
          <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-white px-4 py-3">
            <div className="text-sm font-bold text-foreground">Pesanan self-order baru ({count})</div>
            <div className="flex items-center gap-1">
              <Link
                href="/dashboard/pos/self-orders"
                title="Buka layar penuh (HP/tablet)"
                className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-gray-100"
              >
                <Maximize2 className="size-4" />
              </Link>
              <button
                type="button"
                aria-label="Tutup"
                onClick={() => setOpen(false)}
                className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-gray-100"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <SelfOrderQueue orders={query.data ?? []} loading={query.isLoading} compact />
          </div>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => {
          unlockKdsSound();
          setOpen((value) => !value);
        }}
        aria-label={`Pesanan self-order baru: ${count}`}
        className={cn(
          "fixed bottom-6 right-4 z-40 inline-flex size-14 items-center justify-center rounded-full text-white shadow-xl transition active:scale-95",
          count > 0 ? "bg-primary" : "bg-gray-500"
        )}
      >
        {count > 0 ? <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" /> : null}
        <BellRing className="relative size-6" />
        {count > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex min-w-6 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold leading-6">
            {count}
          </span>
        ) : null}
      </button>
    </>
  );
}
