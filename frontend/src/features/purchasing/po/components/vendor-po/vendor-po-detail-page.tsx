"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { CheckCircle, Loader2, Printer, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NAV_FROM_APPROVAL_PO } from "@/lib/iam/nav-context";
import { useNavFrom } from "@/lib/iam/use-nav-from";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";
import { vendorPoStatusBadge, type SendVia } from "@/lib/purchasing/po-ui-status";
import { BackLink } from "../detail/po-detail-header";
import { ReasonPODialog, SendPODialog, ToneBadge } from "../po-dialogs";

export interface VendorPODetailItem {
  id: string;
  qty_ordered?: number | null;
  qty_received?: number | null;
  harga_satuan?: number | null;
  subtotal?: number | null;
}

export interface VendorPODetailData<Item extends VendorPODetailItem> {
  id: string;
  nomor_po: string;
  status: string;
  tanggal_po: string;
  tanggal_kirim_estimasi?: string | null;
  vendor_name?: string | null;
  vendor_code?: string | null;
  pr_number?: string | null;
  alamat_pengiriman?: string | null;
  catatan?: string | null;
  subtotal?: number;
  diskon_nominal?: number;
  ppn_nominal?: number;
  grand_total?: number;
  total?: number;
  paid_amount?: number;
  outstanding_amount?: number;
  items?: Item[];
}

type Mutation<TVars> = UseMutationResult<unknown, Error, TVars>;

interface VendorPODetailPageProps<Item extends VendorPODetailItem> {
  useDetail: (id: string) => UseQueryResult<VendorPODetailData<Item>>;
  useApprove: () => Mutation<string>;
  useSend: () => Mutation<{ id: string; sentVia: SendVia }>;
  useCancel: () => Mutation<{ id: string; reason: string }>;
  routes: { approvalPo: string; purchasingPo: string };
  /** Judul kolom item, mis. "Barang" atau "Produk". */
  itemLabel: string;
  renderItem: (item: Item) => ReactNode;
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "md:col-span-2" : undefined}>
      <p className="text-xs text-gray-500">{label}</p>
      <div className={wide ? undefined : "font-medium"}>{children}</div>
    </div>
  );
}

function MoneyRow({ label, value, className }: { label: string; value?: number; className?: string }) {
  return (
    <div className={`flex justify-between ${className ?? ""}`}>
      <span>{label}</span>
      <span>{formatRupiah(value)}</span>
    </div>
  );
}

/** Detail PO ke vendor (produk & barang operasional) dengan aksi setujui, kirim, batalkan. */
export function VendorPODetailPage<Item extends VendorPODetailItem>({
  useDetail,
  useApprove,
  useSend,
  useCancel,
  routes,
  itemLabel,
  renderItem,
}: VendorPODetailPageProps<Item>) {
  const params = useParams();
  const poId = params.id as string;
  const fromApproval = useNavFrom() === NAV_FROM_APPROVAL_PO;
  const { data: po, isLoading, isError } = useDetail(poId);
  const approveMutation = useApprove();
  const sendMutation = useSend();
  const cancelMutation = useCancel();
  const [dialog, setDialog] = useState<"send" | "cancel" | null>(null);

  const run = async (action: () => Promise<unknown>, success: string, fallback: string) => {
    try {
      await action();
      toast.success(success);
      setDialog(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : fallback);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-56 items-center justify-center text-sm text-gray-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-pink-600" />
        Memuat purchase order...
      </div>
    );
  }

  if (isError || !po) {
    return <div className="py-12 text-center text-sm text-red-600">Purchase order tidak ditemukan.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <BackLink
            href={fromApproval ? routes.approvalPo : routes.purchasingPo}
            label={fromApproval ? "Kembali ke Persetujuan" : "Kembali"}
          />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{po.nomor_po}</h1>
              <ToneBadge tone={vendorPoStatusBadge(po.status)} />
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {formatDate(po.tanggal_po)} · {po.vendor_name || "-"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {po.status === "draft" && (
            <Button
              className="purchasing-main-button"
              disabled={approveMutation.isPending}
              onClick={() =>
                run(() => approveMutation.mutateAsync(poId), "Purchase order disetujui.", "Gagal menyetujui.")
              }
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              Setujui
            </Button>
          )}
          {po.status === "approved" && (
            <Button className="purchasing-main-button" onClick={() => setDialog("send")}>
              <Send className="mr-2 h-4 w-4" />
              Kirim
            </Button>
          )}
          {po.status !== "cancelled" && po.status !== "received" && (
            <Button variant="outline" className="border-red-200 text-red-600" onClick={() => setDialog("cancel")}>
              <XCircle className="mr-2 h-4 w-4" />
              Batalkan
            </Button>
          )}
          <Link href={`/dashboard/purchasing/print/po/${poId}`} target="_blank">
            <Button variant="outline" className="purchasing-secondary-button">
              <Printer className="mr-2 h-4 w-4" />
              Cetak
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-8">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="text-base">Informasi Order</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 p-4 text-sm md:grid-cols-2">
              <Field label="Vendor">{po.vendor_name || "-"}</Field>
              <Field label="Kode Vendor">{po.vendor_code || "-"}</Field>
              <Field label="Tanggal PO">{formatDate(po.tanggal_po)}</Field>
              <Field label="Estimasi Kirim">{formatDate(po.tanggal_kirim_estimasi)}</Field>
              {po.pr_number && <Field label="Sumber PR">{po.pr_number}</Field>}
              {po.alamat_pengiriman && (
                <Field label="Alamat Pengiriman" wide>
                  {po.alamat_pengiriman}
                </Field>
              )}
              {po.catatan && (
                <Field label="Catatan" wide>
                  {po.catatan}
                </Field>
              )}
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="text-base">Item Order</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto p-4">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-4 py-3 text-left">{itemLabel}</th>
                      <th className="px-4 py-3 text-right">Qty Pesan</th>
                      <th className="px-4 py-3 text-right">Qty Terima</th>
                      <th className="px-4 py-3 text-right">Harga Satuan</th>
                      <th className="px-4 py-3 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(po.items ?? []).map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-3">{renderItem(item)}</td>
                        <td className="px-4 py-3 text-right">{formatNumber(item.qty_ordered, 4)}</td>
                        <td className="px-4 py-3 text-right">{formatNumber(item.qty_received, 4)}</td>
                        <td className="px-4 py-3 text-right">{formatRupiah(item.harga_satuan)}</td>
                        <td className="px-4 py-3 text-right font-medium">{formatRupiah(item.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-gray-200/70 shadow-xs xl:col-span-4 xl:sticky xl:top-6">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="text-base">Ringkasan Keuangan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 text-sm">
            <MoneyRow label="Subtotal" value={po.subtotal} />
            <MoneyRow label="Diskon" value={po.diskon_nominal} />
            <MoneyRow label="PPN" value={po.ppn_nominal} />
            <div className="flex justify-between border-t border-gray-200/70 pt-2 font-semibold">
              <span>Total</span>
              <span className="text-pink-700">{formatRupiah(po.grand_total ?? po.total)}</span>
            </div>
            <MoneyRow label="Dibayar" value={po.paid_amount} className="text-gray-500" />
            <MoneyRow label="Sisa" value={po.outstanding_amount} className="text-gray-500" />
          </CardContent>
        </Card>
      </div>

      <SendPODialog
        open={dialog === "send"}
        onOpenChange={(open) => setDialog(open ? "send" : null)}
        title="Kirim Purchase Order"
        poNumber={po.nomor_po}
        pending={sendMutation.isPending}
        onConfirm={(sentVia) =>
          run(
            () => sendMutation.mutateAsync({ id: poId, sentVia }),
            "Purchase order ditandai sudah dikirim.",
            "Gagal mengirim."
          )
        }
      />

      <ReasonPODialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title="Batalkan Purchase Order"
        description="Tindakan ini tidak dapat dibatalkan."
        label="Alasan Pembatalan"
        placeholder="Alasan pembatalan..."
        confirmLabel="Batalkan PO"
        destructive
        pending={cancelMutation.isPending}
        onConfirm={(reason) =>
          run(
            () => cancelMutation.mutateAsync({ id: poId, reason }),
            "Purchase order dibatalkan.",
            "Gagal membatalkan."
          )
        }
      />
    </div>
  );
}
