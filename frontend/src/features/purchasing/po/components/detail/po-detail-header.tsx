"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle, Lock, Printer, Send, Truck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDate, formatRupiah } from "@/lib/format";
import { RM_ROUTES } from "@/lib/purchasing/item-routes";
import {
  canCancelPurchaseOrder,
  canTrackShipment,
  isPartiallyReceived,
  poStatusBadge,
  type SendVia,
} from "@/lib/purchasing/po-ui-status";
import type { PurchaseOrderWithStats } from "@/types/purchasing";
import {
  useApprovePurchaseOrder,
  useCancelPurchaseOrder,
  useClosePurchaseOrder,
  useSendPurchaseOrder,
} from "../../mutations";
import { ConfirmPODialog, ReasonPODialog, SendPODialog, ToneBadge } from "../po-dialogs";

type DialogKind = "approve" | "send" | "cancel" | "close" | null;

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href}>
      <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
        <ArrowLeft className="h-4 w-4" />
        {label}
      </Button>
    </Link>
  );
}

function shipmentLabel(po: PurchaseOrderWithStats): string {
  if (po.active_delivery_id) {
    return `Lihat Pengiriman${po.active_delivery_number ? ` ${po.active_delivery_number}` : ""}`;
  }
  return isPartiallyReceived(po.status) ? "Kirim Ulang" : "Buat Pengiriman";
}

interface PODetailHeaderProps {
  po: PurchaseOrderWithStats;
  backHref: string;
  backLabel: string;
}

/** Judul PO dan aksi siklus hidup (setujui, kirim, pengiriman, tutup, batalkan). */
export function PODetailHeader({ po, backHref, backLabel }: PODetailHeaderProps) {
  const [dialog, setDialog] = useState<DialogKind>(null);
  const approveMutation = useApprovePurchaseOrder();
  const sendMutation = useSendPurchaseOrder();
  const cancelMutation = useCancelPurchaseOrder();
  const closeMutation = useClosePurchaseOrder();
  const status = po.status.toLowerCase();
  const dialogProps = (kind: Exclude<DialogKind, null>) => ({
    open: dialog === kind,
    onOpenChange: (open: boolean) => setDialog(open ? kind : null),
  });

  const run = async (action: () => Promise<unknown>, success: string, fallback: string) => {
    try {
      await action();
      toast.success(success);
      setDialog(null);
    } catch (error) {
      toast.error(errorMessage(error, fallback));
    }
  };

  const handleSend = (sentVia: SendVia) =>
    run(
      () => sendMutation.mutateAsync({ id: po.id, sentVia }),
      `Purchase order berhasil dikirim via ${sentVia}`,
      "Gagal mengirim purchase order"
    );

  return (
    <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex items-start gap-3">
        <BackLink href={backHref} label={backLabel} />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{po.nomor_po}</h1>
            <ToneBadge tone={poStatusBadge(po.status, "detail")} />
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {po.nama_supplier || "-"}
            <span className="text-gray-300"> · </span>
            {formatDate(po.tanggal_po)}
            <span className="text-gray-300"> · </span>
            {formatRupiah(po.grand_total)}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Link href={`/dashboard/purchasing/print/po/${po.id}`} target="_blank">
          <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
            <Printer className="mr-2 h-4 w-4" />
            Cetak
          </Button>
        </Link>

        {status === "draft" && (
          <>
            <Link href={`${RM_ROUTES.purchasingPo}/edit/${po.id}`}>
              <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
                Ubah
              </Button>
            </Link>
            <Button onClick={() => setDialog("approve")} className="purchasing-main-button w-full sm:w-auto">
              <CheckCircle className="mr-2 h-4 w-4" />
              Setujui
            </Button>
          </>
        )}

        {status === "approved" && (
          <Button onClick={() => setDialog("send")} className="purchasing-main-button w-full sm:w-auto">
            <Send className="mr-2 h-4 w-4" />
            Kirim ke Supplier
          </Button>
        )}

        {canTrackShipment(status) && (
          <Link
            href={
              po.active_delivery_id
                ? `${RM_ROUTES.purchasingDelivery}/${po.active_delivery_id}`
                : `${RM_ROUTES.purchasingDelivery}/insert?po_id=${po.id}`
            }
          >
            <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
              <Truck className="mr-2 h-4 w-4" />
              {shipmentLabel(po)}
            </Button>
          </Link>
        )}

        {isPartiallyReceived(status) && (
          <Button
            variant="outline"
            onClick={() => setDialog("close")}
            className="purchasing-secondary-button w-full sm:w-auto"
          >
            <Lock className="mr-2 h-4 w-4" />
            Tutup PO
          </Button>
        )}

        {canCancelPurchaseOrder(status) && (
          <Button
            variant="outline"
            onClick={() => setDialog("cancel")}
            className="h-10 w-full rounded-lg border-red-200 bg-white px-3 text-sm font-medium text-red-600 shadow-sm hover:!border-red-200 hover:!bg-red-50 hover:!text-red-700 sm:w-auto"
          >
            <XCircle className="mr-2 h-4 w-4" />
            Batalkan
          </Button>
        )}
      </div>

      <ConfirmPODialog
        {...dialogProps("approve")}
        title="Setujui PO"
        description={`Apakah Anda yakin ingin menyetujui purchase order ${po.nomor_po}? Setelah disetujui, purchase order tidak dapat diubah lagi.`}
        confirmLabel="Setujui"
        pending={approveMutation.isPending}
        onConfirm={() =>
          run(
            () => approveMutation.mutateAsync(po.id),
            "Purchase order berhasil disetujui",
            "Gagal menyetujui purchase order"
          )
        }
      />

      <SendPODialog
        {...dialogProps("send")}
        title="Kirim Purchase Order"
        poNumber={po.nomor_po}
        pending={sendMutation.isPending}
        onConfirm={handleSend}
      />

      <ReasonPODialog
        {...dialogProps("cancel")}
        title="Batalkan Purchase Order"
        description={`Apakah Anda yakin ingin membatalkan purchase order ${po.nomor_po}? Masukkan alasan pembatalan.`}
        label="Alasan Pembatalan"
        placeholder="Masukkan alasan..."
        confirmLabel="Batalkan Purchase Order"
        destructive
        pending={cancelMutation.isPending}
        onConfirm={(reason) =>
          run(
            () => cancelMutation.mutateAsync({ id: po.id, reason }),
            "Purchase order berhasil dibatalkan",
            "Gagal membatalkan purchase order"
          )
        }
      />

      <ReasonPODialog
        {...dialogProps("close")}
        title="Tutup Purchase Order"
        description={`Tutup ${po.nomor_po} jika supplier tidak akan mengirim sisa barang. Tagihan hanya menghitung qty yang sudah diterima (lolos QC). Pengiriman baru tidak lagi diizinkan.`}
        label="Alasan Penutupan"
        placeholder="Contoh: Supplier tidak mengganti barang gagal QC"
        confirmLabel="Tutup Purchase Order"
        confirmIcon={<Lock className="mr-2 h-4 w-4" />}
        pending={closeMutation.isPending}
        onConfirm={(reason) =>
          run(
            () => closeMutation.mutateAsync({ id: po.id, reason }),
            "Purchase order ditutup. Kekurangan qty tidak ditagihkan.",
            "Gagal menutup purchase order"
          )
        }
      />
    </div>
  );
}
