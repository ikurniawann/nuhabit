"use client";

import Link from "next/link";
import { CheckCircle, Eye, Loader2, Pencil, Send, Truck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate, formatRupiah } from "@/lib/format";
import { RM_ROUTES } from "@/lib/purchasing/item-routes";
import {
  canCancelPurchaseOrder,
  canReshipPurchaseOrder,
  canTrackShipment,
  poLifecycleBadge,
  poStatusBadge,
} from "@/lib/purchasing/po-ui-status";
import type { PurchaseOrderWithStats } from "@/types/purchasing";
import { ToneBadge } from "./po-dialogs";

function shipmentHref(po: PurchaseOrderWithStats) {
  return po.active_delivery_id
    ? `${RM_ROUTES.purchasingDelivery}/${po.active_delivery_id}`
    : `${RM_ROUTES.purchasingDelivery}/insert?po_id=${po.id}`;
}

function progressBarClass(progress: number) {
  if (progress >= 100) return "bg-green-500";
  return progress > 0 ? "bg-yellow-400" : "bg-gray-300";
}

interface POListRowProps {
  po: PurchaseOrderWithStats;
  selected: boolean;
  processing: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onSend: () => void;
  onCancel: () => void;
}

export function POListRow({ po, selected, processing, onToggle, onApprove, onSend, onCancel }: POListRowProps) {
  const status = po.status.toLowerCase();
  const progress = po.overall_progress_pct || 0;

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3">
        <input type="checkbox" checked={selected} onChange={onToggle} className="rounded border-gray-300" />
      </td>
      <td className="px-4 py-3 font-medium">
        <Link href={RM_ROUTES.purchasingPoDetail(po.id)} className="text-pink-600 hover:underline">
          {po.nomor_po}
        </Link>
      </td>
      <td className="px-4 py-3 text-gray-700">
        {po.pr_id && po.pr_number ? (
          <Link href={RM_ROUTES.purchasingPrDetail(po.pr_id)} className="text-pink-600 hover:underline">
            {po.pr_number}
          </Link>
        ) : (
          "-"
        )}
      </td>
      <td className="px-4 py-3 text-gray-700">{po.nama_supplier || po.supplier_kode}</td>
      <td className="px-4 py-3 text-gray-700">{formatDate(po.tanggal_po)}</td>
      <td className="px-4 py-3 text-right font-medium">{formatRupiah(po.grand_total)}</td>
      <td className="px-4 py-3 text-center">
        <div className="flex flex-col items-center gap-1">
          <ToneBadge tone={poStatusBadge(po.status)} />
          <ToneBadge tone={poLifecycleBadge(po.lifecycle_status)} />
        </div>
      </td>
      <td className="px-4 py-3">
        {status !== "draft" && status !== "cancelled" && (
          <div className="grid gap-1">
            <div className="flex items-center gap-2">
              <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-200">
                <div className={`h-full ${progressBarClass(progress)}`} style={{ width: `${progress}%` }} />
              </div>
              <span className="text-xs text-muted-foreground">{progress}%</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Barang {po.received_percentage || 0}% · Pembayaran {po.payment_progress_pct || 0}%
            </div>
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <Link href={`/dashboard/purchasing/po/${po.id}`}>
            <Button variant="ghost" size="sm" className="cursor-pointer" title="Lihat detail">
              <Eye className="h-4 w-4" />
            </Button>
          </Link>
          {status === "draft" && (
            <>
              <Link href={`/dashboard/purchasing/po/edit/${po.id}`}>
                <Button variant="ghost" size="sm" className="cursor-pointer" title="Ubah purchase order">
                  <Pencil className="h-4 w-4" />
                </Button>
              </Link>
              <Button variant="ghost" size="sm" onClick={onApprove} disabled={processing} title="Setujui">
                {processing ? (
                  <Loader2 className="h-4 w-4 animate-spin text-green-600" />
                ) : (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                )}
              </Button>
            </>
          )}
          {status === "approved" && (
            <Button variant="ghost" size="sm" onClick={onSend} disabled={processing} title="Kirim ke supplier">
              {processing ? (
                <Loader2 className="h-4 w-4 animate-spin text-pink-600" />
              ) : (
                <Send className="h-4 w-4 text-pink-600" />
              )}
            </Button>
          )}
          {canReshipPurchaseOrder(po) ? (
            <Link href={shipmentHref(po)}>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-lg border-primary/20 px-2.5 text-xs font-medium text-brand-text shadow-sm hover:!border-primary/30 hover:!bg-primary/5 hover:!text-brand-text"
                title="Kirim ulang sisa qty PO"
              >
                <Truck className="h-3.5 w-3.5" />
                Kirim Ulang
              </Button>
            </Link>
          ) : canTrackShipment(status) ? (
            <Link href={shipmentHref(po)}>
              <Button
                variant="ghost"
                size="sm"
                className="cursor-pointer"
                title={
                  po.active_delivery_id
                    ? `Lacak pengiriman${po.active_delivery_number ? ` (${po.active_delivery_number})` : ""}`
                    : "Buat pengiriman"
                }
              >
                <Truck className="h-4 w-4 text-blue-600" />
              </Button>
            </Link>
          ) : null}
          {canCancelPurchaseOrder(status, { allowClosed: true }) && (
            <Button variant="ghost" size="sm" onClick={onCancel} title="Batalkan">
              <XCircle className="h-4 w-4 text-red-600" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
