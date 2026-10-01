"use client";

import { Minus, Plus } from "lucide-react";
import { formatRupiah } from "@/lib/table-order/menu";
import type { CartLine } from "@/lib/table-order/pricing";
import { BottomSheet } from "./sheet";

/**
 * Produk dengan >1 varian di keranjang: pemesan memilih varian mana yang
 * dikurangi (revisi owner 2026-10-01) — bukan otomatis varian terakhir.
 */
export function DecrementSheet({
  productName,
  lines,
  onQuantity,
  onClose,
}: {
  productName: string | null;
  lines: CartLine[];
  onQuantity: (cartId: string, delta: number) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      open={Boolean(productName) && lines.length > 0}
      onClose={onClose}
      title={`Ubah jumlah ${productName ?? ""}`}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="h-11 w-full rounded-xl bg-primary text-sm font-bold text-white"
        >
          Selesai
        </button>
      }
    >
      <p className="-mt-1 mb-3 text-sm text-gray-500">Pilih varian yang ingin dikurangi.</p>
      <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200">
        {lines.map((line) => {
          const detail = [line.variantName, ...line.modifierNames].filter(Boolean).join(" · ");
          const label = detail ? `${line.name} ${detail}` : line.name;
          return (
            <li key={line.cartId} className="flex items-center gap-3 px-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-gray-900">{detail || "Standar"}</div>
                <div className="text-xs text-gray-500">{formatRupiah(line.unitPrice)} / item</div>
              </div>
              <div className="inline-flex h-9 items-center rounded-full border border-primary">
                <button
                  type="button"
                  onClick={() => onQuantity(line.cartId, -1)}
                  className="flex size-9 items-center justify-center text-primary"
                  aria-label={`Kurangi ${label}`}
                >
                  <Minus className="size-4" />
                </button>
                <span className="min-w-7 text-center text-sm font-bold tabular-nums">{line.quantity}</span>
                <button
                  type="button"
                  onClick={() => onQuantity(line.cartId, 1)}
                  className="flex size-9 items-center justify-center text-primary"
                  aria-label={`Tambah ${label}`}
                >
                  <Plus className="size-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}
