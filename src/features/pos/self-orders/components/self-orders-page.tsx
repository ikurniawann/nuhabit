"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { BellRing, RefreshCw, Volume2 } from "lucide-react";
import { unlockKdsSound } from "@/features/pos/kds/queries";
import { SelfOrderQueue, useIncomingSelfOrders } from "./self-order-queue";

/**
 * Layar pesanan self-order utk HP kasir (dibuka dari link "Buatkan Pesanan"
 * di notifikasi WA/Telegram). Mirip KDS, tampilan mobile: daftar pesanan
 * baru + tombol "Dibuat".
 */
export function SelfOrdersPage() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("order");
  const query = useIncomingSelfOrders();
  const [soundOn, setSoundOn] = useState(false);
  const orders = query.data ?? [];

  return (
    <div className="mx-auto w-full max-w-lg space-y-3 pb-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <BellRing className="size-5 text-brand-text" /> Pesanan Self-Order
          </h1>
          <p className="text-xs text-muted-foreground">
            {orders.length > 0 ? `${orders.length} pesanan menunggu dibuat` : "Diperbarui otomatis tiap 5 detik"}
          </p>
        </div>
        <div className="flex gap-2">
          {!soundOn ? (
            <button
              type="button"
              onClick={() => {
                unlockKdsSound();
                setSoundOn(true);
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 text-xs font-semibold text-brand-text"
            >
              <Volume2 className="size-4" /> Aktifkan suara
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void query.refetch()}
            aria-label="Muat ulang"
            className="inline-flex size-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-muted-foreground"
          >
            <RefreshCw className={query.isFetching ? "size-4 animate-spin" : "size-4"} />
          </button>
        </div>
      </div>
      {query.isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {query.error instanceof Error ? query.error.message : "Gagal memuat pesanan"}
        </div>
      ) : null}
      <SelfOrderQueue orders={orders} loading={query.isLoading} highlightId={highlightId} />
    </div>
  );
}
