"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { ImageIcon, ScanLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { paymentFlowFrom } from "@/lib/table-order/order-status";
import type { Order } from "./types";

/**
 * Penanda order self-order yang dibayar lewat Static QRIS. Bila pemesan sudah
 * mengunggah bukti, badge bisa diklik untuk melihat gambarnya — kasir
 * mencocokkan nominal lalu melunasi bill seperti biasa (metode QRIS).
 */
export function PaymentProofBadge({ order }: { order: Order | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!order || order.payment_status === "paid") return null;
  if (paymentFlowFrom(order.special_requests, null) !== "static_qris") return null;

  const uploadedAt = order.payment_proof_uploaded_at;
  if (!uploadedAt) {
    return (
      <Badge variant="outline" className="mt-2 ml-1 border-amber-200 bg-amber-50 text-[10px] text-amber-700">
        <ScanLine className="mr-1 size-3" /> Static QRIS · menunggu bukti
      </Badge>
    );
  }

  const src = `/api/pos/orders/${encodeURIComponent(order.id)}/payment-proof?v=${encodeURIComponent(uploadedAt)}`;
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        className="mt-2 ml-1 inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
      >
        <ImageIcon className="mr-1 size-3" /> Bukti QRIS · lihat
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg" onClick={(event) => event.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Bukti bayar Static QRIS</DialogTitle>
            <DialogDescription>
              {order.order_number || order.id.slice(0, 8)} · total{" "}
              {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(
                Number(order.total_amount) || 0
              )}{" "}
              · diunggah{" "}
              {new Date(uploadedAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}. Cocokkan
              nominal & waktu, lalu lunasi bill dengan metode QRIS.
            </DialogDescription>
          </DialogHeader>
          <a href={src} target="_blank" rel="noreferrer">
            <img src={src} alt="Bukti bayar" className="max-h-[70vh] w-full rounded-lg border object-contain" />
          </a>
        </DialogContent>
      </Dialog>
    </>
  );
}
