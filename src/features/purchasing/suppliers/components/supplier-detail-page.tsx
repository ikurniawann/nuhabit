"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import PurchasingGuard from "@/features/purchasing/components/shared/purchasing-guard";
import { SupplierPriceHistoryPanel } from "@/features/purchasing/suppliers/components/supplier-price-history-panel";
import {
  Building2,
  Pencil,
  Power,
  ArrowLeft,
  CreditCard,
  FileText,
  Package,
  TrendingUp,
  Truck,
  User,
  Loader2,
} from "lucide-react";
import { SupplierPOSummary } from "@/types/supplier";
import { RM_ROUTES } from "@/lib/purchasing/item-routes";
import { useSupplier, useSupplierPOHistory } from "../queries";
import { useDeleteSupplier } from "../mutations";
import { suppliersQueryKeys } from "../query-keys";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { formatDate, formatNumber } from "@/lib/format";

const PO_STATUS_STYLES: Record<string, string> = {
  draft: "border-gray-200 bg-gray-50 text-gray-700",
  pending_head: "border-amber-200 bg-amber-50 text-amber-700",
  pending_finance: "border-orange-200 bg-orange-50 text-orange-700",
  pending_direksi: "border-orange-200 bg-orange-50 text-orange-700",
  approved: "border-blue-200 bg-blue-50 text-blue-700",
  sent: "border-indigo-200 bg-indigo-50 text-indigo-700",
  partially_received: "border-amber-200 bg-amber-50 text-amber-700",
  received: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-red-200 bg-red-50 text-red-700",
  cancelled: "border-gray-200 bg-gray-100 text-gray-600",
};

const PO_STATUS_LABELS: Record<string, string> = {
  draft: "Draf",
  pending_head: "Menunggu Kepala Departemen",
  pending_finance: "Menunggu Finance",
  pending_direksi: "Menunggu Direktur",
  approved: "Disetujui",
  sent: "Terkirim",
  partially_received: "Diterima Sebagian",
  received: "Diterima",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
};

function formatMoney(amount: number, currency = "IDR") {
  return `${formatNumber(amount)} ${currency}`;
}

function formatPaymentTerms(value?: string | null) {
  if (!value) return "-";
  return value.replace("TOP", "TOP ");
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function DetailField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium break-words text-gray-900">{value || "-"}</dd>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right font-medium text-gray-900">{value}</dd>
    </div>
  );
}

export function SupplierDetailPage() {
  return (
    <PurchasingGuard minRole="purchasing_staff">
      <SupplierDetailInner />
    </PurchasingGuard>
  );
}

function SupplierDetailInner() {
  const params = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const supplierId = params.id as string;
  const isAdmin =
    user?.role === "purchasing_admin" || user?.role === "admin" || user?.role === "super_admin";

  const supplierQuery = useSupplier(supplierId);
  const supplier = supplierQuery.data ?? null;
  const loading = supplierQuery.isLoading;

  const poHistoryQuery = useSupplierPOHistory(supplierId);
  const poHistory: SupplierPOSummary[] = poHistoryQuery.data?.data ?? [];
  const poLoading = poHistoryQuery.isLoading;

  const [deactivateDialog, setDeactivateDialog] = useState(false);
  const deactivateMutation = useDeleteSupplier();
  const deactivateLoading = deactivateMutation.isPending;

  async function handleDeactivate() {
    if (!supplier || deactivateLoading) return;
    try {
      await deactivateMutation.mutateAsync(supplier.id);
      toast.success(`Supplier "${supplier.nama_supplier}" berhasil dinonaktifkan.`);
      setDeactivateDialog(false);
      queryClient.invalidateQueries({ queryKey: suppliersQueryKeys.detail(supplierId) });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Gagal menonaktifkan supplier."));
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-56 items-center justify-center text-sm text-gray-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-pink-600" />
        Memuat supplier...
      </div>
    );
  }

  if (supplierQuery.isError || !supplier) {
    return (
      <div className="space-y-4">
        <Link href={RM_ROUTES.purchasingSuppliers}>
          <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
            <ArrowLeft className="h-4 w-4" />
            Kembali
          </Button>
        </Link>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="py-12 text-center text-sm text-gray-500">
            {getErrorMessage(
              supplierQuery.error,
              "Supplier tidak ditemukan atau gagal dimuat."
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const a = supplier.analytics;
  const hasBankInfo = Boolean(
    supplier.bank_nama || supplier.bank_rekening || supplier.bank_atas_nama
  );
  const hasContactInfo = Boolean(
    supplier.pic_name || supplier.pic_jabatan || supplier.pic_email || supplier.pic_phone
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Link href={RM_ROUTES.purchasingSuppliers}>
            <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
              <ArrowLeft className="h-4 w-4" />
              Kembali
            </Button>
          </Link>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{supplier.nama_supplier}</h1>
              <Badge
                variant="outline"
                className={
                  supplier.is_active
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-gray-200 bg-gray-50 text-gray-600"
                }
              >
                {supplier.is_active ? "Aktif" : "Nonaktif"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {supplier.kode || "-"}
              <span className="text-gray-300"> · </span>
              {supplier.kota || "-"}
              <span className="text-gray-300"> · </span>
              Bergabung {formatDate(supplier.created_at)}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {isAdmin && (
            <Link href={RM_ROUTES.purchasingSuppliersEdit(supplier.id)}>
              <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
                <Pencil className="mr-2 h-4 w-4" />
                Ubah
              </Button>
            </Link>
          )}
          {isAdmin && supplier.is_active && (
            <Button
              variant="outline"
              onClick={() => setDeactivateDialog(true)}
              className="h-10 w-full rounded-lg border-red-200 bg-white px-3 text-sm font-medium text-red-600 shadow-sm hover:!border-red-200 hover:!bg-red-50 hover:!text-red-700 sm:w-auto"
            >
              <Power className="mr-2 h-4 w-4" />
              Nonaktifkan
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-pink-50 text-pink-600">
                <FileText className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Purchase Order Aktif</p>
                <p className="text-lg font-bold text-gray-900">{a.po_aktif_count}</p>
                <p className="text-xs text-gray-400">
                  {formatMoney(a.po_aktif_nilai, supplier.currency)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <TrendingUp className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Transaksi 12 Bulan</p>
                <p className="text-lg font-bold text-gray-900">{a.jumlah_po_12_bulan}</p>
                <p className="text-xs text-gray-400">
                  {formatMoney(a.total_transaksi_12_bulan, supplier.currency)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <Truck className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Pengiriman Tepat Waktu</p>
                <p className="text-lg font-bold text-emerald-700">
                  {a.on_time_delivery_rate.toFixed(1)}%
                </p>
                <p className="text-xs text-gray-400">12 bulan terakhir</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                <CreditCard className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Termin Pembayaran</p>
                <p className="text-lg font-bold text-gray-900">
                  {formatPaymentTerms(supplier.payment_terms)}
                </p>
                <p className="text-xs text-gray-400">{supplier.currency}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-8">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4 text-pink-600" />
                Informasi Perusahaan
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 p-4 md:grid-cols-2">
              <DetailField label="Kode" value={supplier.kode} />
              <DetailField label="Nama Supplier" value={supplier.nama_supplier} />
              <DetailField label="Kategori" value={supplier.kategori} />
              <DetailField label="NPWP" value={supplier.npwp} />
              <DetailField label="Kota" value={supplier.kota} />
              <DetailField label="Mata Uang" value={supplier.currency} />
              <DetailField label="Telepon" value={supplier.telepon} />
              <DetailField label="Email" value={supplier.email} />
              {supplier.alamat && (
                <div className="border-t border-gray-200/70 pt-4 md:col-span-2">
                  <p className="text-xs font-medium text-gray-500">Alamat</p>
                  <p className="mt-1 text-sm whitespace-pre-wrap text-gray-700">
                    {supplier.alamat}
                  </p>
                </div>
              )}
              {supplier.catatan && (
                <div className="border-t border-gray-200/70 pt-4 md:col-span-2">
                  <p className="text-xs font-medium text-gray-500">Catatan</p>
                  <p className="mt-1 text-sm whitespace-pre-wrap text-gray-700">
                    {supplier.catatan}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4 text-pink-600" />
                Narahubung
              </CardTitle>
            </CardHeader>
            <CardContent className={hasContactInfo ? "grid gap-4 p-4 md:grid-cols-2" : "p-0"}>
              {hasContactInfo ? (
                <>
                  <DetailField label="Nama" value={supplier.pic_name} />
                  <DetailField label="Jabatan" value={supplier.pic_jabatan} />
                  <DetailField label="Email" value={supplier.pic_email} />
                  <DetailField label="Telepon" value={supplier.pic_phone} />
                </>
              ) : (
                <div className="py-12 text-center text-sm text-gray-500">
                  Belum ada informasi narahubung.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-pink-600" />
                Riwayat Purchase Order
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {poLoading ? (
                <div className="flex items-center justify-center py-12 text-sm text-gray-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin text-pink-600" />
                  Memuat purchase order...
                </div>
              ) : poHistory.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-500">
                  Belum ada purchase order.
                </div>
              ) : (
                <div className="overflow-x-auto p-4">
                  <table className="min-w-full text-sm">
                    <thead className="border-b border-gray-100 bg-gray-50 text-xs tracking-wide text-gray-500 uppercase">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold">Purchase Order</th>
                        <th className="px-4 py-3 text-left font-semibold">Tanggal</th>
                        <th className="px-4 py-3 text-center font-semibold">Status</th>
                        <th className="px-4 py-3 text-right font-semibold">Item</th>
                        <th className="px-4 py-3 text-right font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {poHistory.map((po) => (
                        <tr key={po.id} className="hover:bg-gray-50/80">
                          <td className="px-4 py-3">
                            <Link
                              href={RM_ROUTES.purchasingPoDetail(po.id)}
                              className="font-medium text-pink-700 hover:underline"
                            >
                              {po.po_number}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{formatDate(po.tanggal)}</td>
                          <td className="px-4 py-3 text-center">
                            <Badge
                              variant="outline"
                              className={
                                PO_STATUS_STYLES[po.status] ??
                                "border-gray-200 bg-gray-50 text-gray-700"
                              }
                            >
                              {PO_STATUS_LABELS[po.status] ?? po.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-700">{po.jumlah_item}</td>
                          <td className="px-4 py-3 text-right font-medium text-gray-900">
                            {formatMoney(po.total, po.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <SupplierPriceHistoryPanel
            supplierId={supplier.id}
            supplierName={supplier.nama_supplier}
          />
        </div>

        <div className="space-y-6 xl:col-span-4">
          <Card className="border-gray-200/70 shadow-xs xl:sticky xl:top-6">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="text-base">Ringkasan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <dl className="space-y-3 text-sm">
                <SummaryRow
                  label="Termin Pembayaran"
                  value={formatPaymentTerms(supplier.payment_terms)}
                />
                <SummaryRow label="Mata Uang" value={supplier.currency} />
                <SummaryRow label="Purchase Order Aktif" value={String(a.po_aktif_count)} />
                <SummaryRow
                  label="Transaksi 12 Bulan"
                  value={formatMoney(a.total_transaksi_12_bulan, supplier.currency)}
                />
                <div className="flex items-start justify-between gap-3 border-t border-gray-200/70 pt-3">
                  <dt className="font-medium text-gray-900">Nilai PO Aktif</dt>
                  <dd className="text-right font-semibold text-pink-700">
                    {formatMoney(a.po_aktif_nilai, supplier.currency)}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="h-4 w-4 text-pink-600" />
                Pembayaran & Bank
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              <DetailField
                label="Termin Pembayaran"
                value={formatPaymentTerms(supplier.payment_terms)}
              />
              {hasBankInfo ? (
                <div className="space-y-4 border-t border-gray-200/70 pt-4">
                  <DetailField label="Bank" value={supplier.bank_nama} />
                  <DetailField label="Nomor Rekening" value={supplier.bank_rekening} />
                  <DetailField label="Atas Nama" value={supplier.bank_atas_nama} />
                </div>
              ) : (
                <p className="border-t border-gray-200/70 pt-4 text-sm text-gray-500">
                  Belum ada informasi rekening bank.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4 text-pink-600" />
                Bahan Baku Sering Dibeli
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {a.bahan_sering_dibeli?.length ? (
                <div className="flex flex-wrap gap-2">
                  {a.bahan_sering_dibeli.map((bahan, index) => (
                    <Badge
                      key={index}
                      variant="outline"
                      className="border-gray-200 bg-gray-50 text-gray-700"
                    >
                      {bahan}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">Belum ada data pembelian bahan baku.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={deactivateDialog}
        onOpenChange={setDeactivateDialog}
        title="Nonaktifkan Supplier?"
        description={`Apakah Anda yakin ingin menonaktifkan "${supplier.nama_supplier}"? Supplier tidak akan muncul lagi di daftar aktif.`}
        confirmLabel="Nonaktifkan"
        cancelLabel="Batal"
        loadingLabel="Menonaktifkan..."
        loading={deactivateLoading}
        onConfirm={handleDeactivate}
      />
    </div>
  );
}
