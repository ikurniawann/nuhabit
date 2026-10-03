"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useGrn, useGrnQC, useGrnVendorCredits } from "../queries";
import type { PurchasingModuleType } from "../api";
import { RM_ROUTES, PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeftIcon,
  Banknote,
  ClipboardCheck,
  FileText,
  Info,
  Loader2Icon,
  Package,
  Printer,
  TruckIcon,
} from "lucide-react";

type GrnDetailItem = {
  id: string;
  raw_material?: {
    nama?: string | null;
    kode?: string | null;
    satuan_besar?: { nama?: string | null; kode?: string | null } | null;
  } | null;
  product?: {
    nama?: string | null;
    kode?: string | null;
  } | null;
  satuan?: { nama?: string | null; kode?: string | null } | null;
  purchase_order_item?: {
    qty_ordered?: number | null;
    harga_satuan?: number | null;
    satuan?: { nama?: string | null; kode?: string | null } | null;
  } | null;
  qty_diterima?: number | null;
  qty_ditolak?: number | null;
  catatan?: string | null;
  batch_number?: string | null;
  expiry_date?: string | null;
};

type GrnDetail = {
  id: string;
  nomor_grn?: string | null;
  status?: string | null;
  po_number?: string | null;
  purchase_order_id?: string | null;
  tanggal_penerimaan?: string | null;
  supplier_name?: string | null;
  no_surat_jalan?: string | null;
  total_item_diterima?: number | null;
  total_item_ditolak?: number | null;
  delivery_id?: string | null;
  delivery_number?: string | null;
  catatan?: string | null;
  supplier?: {
    nama_supplier?: string | null;
    kode?: string | null;
    email?: string | null;
    telepon?: string | null;
  } | null;
  purchase_order?: {
    id?: string | null;
    nomor_po?: string | null;
    status?: string | null;
    tanggal_po?: string | null;
    total?: number | null;
  } | null;
  delivery?: {
    nomor_resi?: string | null;
    no_surat_jalan?: string | null;
    kurir?: string | null;
    status?: string | null;
    tanggal_kirim?: string | null;
    tanggal_estimasi_tiba?: string | null;
    tanggal_aktual_tiba?: string | null;
  } | null;
  items?: GrnDetailItem[];
};

type QcInspection = {
  id?: string;
  status?: string | null;
  hasil?: string | null;
  inventory_posted?: boolean | null;
  inspected_at?: string | null;
  tanggal_inspeksi?: string | null;
  catatan_qc?: string | null;
  catatan?: string | null;
  items?: {
    qty_accepted?: number | null;
    qty_rejected?: number | null;
    item_status?: string | null;
    raw_material?: { nama?: string | null; kode?: string | null } | null;
  }[];
  inspected_by_user?: { email?: string | null } | null;
  inspector?: { email?: string | null; name?: string | null } | null;
};

const STATUS_STYLES: Record<string, string> = {
  pending: "border-slate-200 bg-slate-100 text-slate-700",
  partially_received: "border-amber-200 bg-amber-50 text-amber-700",
  received: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-red-200 bg-red-50 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Menunggu QC",
  partially_received: "Diterima Sebagian",
  received: "Diterima Penuh",
  rejected: "Ditolak",
};

const CREDIT_SOURCE_LABELS: Record<string, string> = {
  receive_reject: "Tolak Penerimaan",
  qc_reject: "Tolak QC",
};

const CREDIT_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Menunggu Persetujuan",
  approved: "Disetujui",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
};

const CREDIT_STATUS_STYLES: Record<string, string> = {
  draft: "border-amber-200 bg-amber-50 text-amber-700",
  pending_approval: "border-amber-200 bg-amber-50 text-amber-700",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-red-200 bg-red-50 text-red-700",
  cancelled: "border-gray-200 bg-gray-50 text-gray-600",
};

const QC_STATUS_LABELS: Record<string, string> = {
  approved: "Disetujui",
  partial: "Sebagian",
  rejected: "Ditolak",
  pending: "Menunggu",
};

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatNumber(value?: number | null) {
  return Number(value || 0).toLocaleString("id-ID", { maximumFractionDigits: 4 });
}

function formatCurrency(value?: number | null) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function statusBadge(status?: string | null) {
  const normalized = String(status || "").toLowerCase();
  return (
    <Badge variant="outline" className={STATUS_STYLES[normalized] || "border-gray-200 bg-gray-100 text-gray-800"}>
      {STATUS_LABELS[normalized] || status || "-"}
    </Badge>
  );
}

function DetailField({
  label,
  value,
  href,
  className,
}: {
  label: string;
  value: string;
  href?: string;
  className?: string;
}) {
  const content = (
    <div className={className}>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={`mt-0.5 text-sm font-medium text-gray-900 ${href ? "text-pink-700 hover:underline" : ""}`}>
        {value}
      </dd>
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}

export function GRNDetailPage({
  moduleType = "raw_material",
}: {
  moduleType?: PurchasingModuleType;
}) {
  const isProduct = moduleType === "product";
  const listRoute = isProduct ? PRODUCT_ROUTES.purchasingReceive : RM_ROUTES.purchasingGrn;
  const supplierLabel = isProduct ? "Vendor" : "Supplier";
  const itemColumnLabel = isProduct ? "Produk" : "Bahan Baku";

  const params = useParams();
  const grnId = params.id as string;

  const grnQuery = useGrn<GrnDetail>(grnId);
  const qcQuery = useGrnQC<QcInspection>(grnId);
  const creditsQuery = useGrnVendorCredits(grnId);
  const grn = grnQuery.data;
  const qc = qcQuery.data ?? null;
  const vendorCredits = creditsQuery.data ?? [];
  const loading = grnQuery.isLoading;

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="flex min-h-56 items-center justify-center text-sm text-gray-500">
        <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
        Memuat detail GRN...
      </div>
    );
  }

  if (grnQuery.isError) {
    return (
      <div className="space-y-4">
        <Link href={listRoute}>
          <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
            <ArrowLeftIcon className="h-4 w-4" />
            Kembali
          </Button>
        </Link>
        <Card className="border-red-100">
          <CardContent className="py-12 text-center">
            <p className="font-medium text-red-700">Gagal memuat detail GRN</p>
            <p className="mt-2 text-sm text-red-600">
              {grnQuery.error instanceof Error ? grnQuery.error.message : "Terjadi kesalahan"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!grn) {
    return (
      <div className="space-y-4">
        <Link href={listRoute}>
          <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
            <ArrowLeftIcon className="h-4 w-4" />
            Kembali
          </Button>
        </Link>
        <Card className="border-gray-200/70">
          <CardContent className="py-12 text-center text-gray-500">GRN tidak ditemukan.</CardContent>
        </Card>
      </div>
    );
  }

  const poId = grn.purchase_order?.id || grn.purchase_order_id;
  const poNumber = grn.po_number || grn.purchase_order?.nomor_po || "-";
  const totalAccepted = Number(grn.total_item_diterima || 0);
  const totalRejected = Number(grn.total_item_ditolak || 0);
  const totalChecked = totalAccepted + totalRejected;
  const acceptedPct = totalChecked > 0 ? Math.round((totalAccepted / totalChecked) * 100) : 0;
  const qcStatus = String(qc?.status || qc?.hasil || "").toLowerCase();
  const canRunQc = grn.status === "pending" && !qc?.inventory_posted;
  // Sisa PO tidak dilanjutkan di GRN yang sama — buat pengiriman baru.
  const canReshipRemaining =
    grn.status === "partially_received" && !!poId;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Link href={listRoute}>
            <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
              <ArrowLeftIcon className="h-4 w-4" />
              Kembali
            </Button>
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{grn.nomor_grn}</h1>
              {statusBadge(grn.status)}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Purchase Order {poNumber} · {formatDate(grn.tanggal_penerimaan)}
              {grn.supplier_name ? ` · ${grn.supplier_name}` : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            variant="outline"
            onClick={handlePrint}
            className="purchasing-secondary-button w-full sm:w-auto"
          >
            <Printer className="mr-2 h-4 w-4" />
            Cetak
          </Button>
          {canRunQc && (
            <Link
              href={
                isProduct
                  ? PRODUCT_ROUTES.purchasingReceiveQc(grn.id)
                  : RM_ROUTES.purchasingGrnQc(grn.id)
              }
            >
              <Button className="purchasing-main-button w-full sm:w-auto">
                <ClipboardCheck className="mr-2 h-4 w-4" />
                Jalankan QC
              </Button>
            </Link>
          )}
          {canReshipRemaining && (
            <Link
              href={
                isProduct
                  ? `${PRODUCT_ROUTES.purchasingDeliveryInsert}?po_id=${poId}`
                  : `${RM_ROUTES.purchasingDelivery}/insert?po_id=${poId}`
              }
            >
              <Button className="purchasing-main-button w-full sm:w-auto">
                <TruckIcon className="mr-2 h-4 w-4" />
                Kirim Ulang
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-8">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-pink-600" />
                Informasi Penerimaan
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 p-4 md:grid-cols-2">
              <DetailField label="No. GRN" value={grn.nomor_grn || "-"} />
              <DetailField label="Tanggal Penerimaan" value={formatDate(grn.tanggal_penerimaan)} />
              <DetailField
                label="Purchase Order"
                value={poNumber}
                href={poId ? (isProduct ? PRODUCT_ROUTES.purchasingPoDetail(poId) : `/dashboard/purchasing/po/${poId}`) : undefined}
              />
              <DetailField
                label="No. Surat Jalan"
                value={grn.no_surat_jalan || grn.delivery?.no_surat_jalan || "-"}
              />
              <DetailField
                label={supplierLabel}
                value={grn.supplier_name || grn.supplier?.nama_supplier || "-"}
              />
              <DetailField label={`Kode ${supplierLabel}`} value={grn.supplier?.kode || "-"} />
              <DetailField label="Catatan" value={grn.catatan || "-"} className="md:col-span-2" />
            </CardContent>
          </Card>

          {grn.delivery_id && (
            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TruckIcon className="h-4 w-4 text-pink-600" />
                  Informasi Pengiriman
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 p-4 md:grid-cols-2">
                <DetailField
                  label="No. Pengiriman"
                  value={grn.delivery_number || grn.delivery?.nomor_resi || "-"}
                  href={
                    isProduct
                      ? PRODUCT_ROUTES.purchasingDeliveryDetail(grn.delivery_id)
                      : `/dashboard/purchasing/delivery/${grn.delivery_id}`
                  }
                />
                <DetailField label="Kurir" value={grn.delivery?.kurir || "-"} />
                <DetailField label="Tanggal Kirim" value={formatDate(grn.delivery?.tanggal_kirim)} />
                <DetailField label="Tanggal Tiba Aktual" value={formatDate(grn.delivery?.tanggal_aktual_tiba)} />
              </CardContent>
            </Card>
          )}

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4 text-pink-600" />
                Item Diterima
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="p-4">
                <div className="overflow-x-auto rounded-xl border border-gray-200/70">
                  <table className="w-full table-fixed border-collapse text-sm [&_td]:border [&_td]:border-gray-200/70 [&_th]:border [&_th]:border-gray-200/70">
                    <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold">{itemColumnLabel}</th>
                        <th className="w-[72px] px-2 py-3 text-center font-semibold">Satuan</th>
                        <th className="w-[84px] px-2 py-3 text-center font-semibold">Dipesan</th>
                        <th className="w-[84px] px-2 py-3 text-center font-semibold">Baik</th>
                        <th className="w-[84px] px-2 py-3 text-center font-semibold">Tolak</th>
                        <th className="w-[120px] px-2 py-3 text-right font-semibold">Harga Satuan</th>
                        <th className="px-4 py-3 text-left font-semibold">Catatan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(grn.items || []).length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                            Tidak ada item penerimaan.
                          </td>
                        </tr>
                      ) : (
                        grn.items?.map((item) => (
                          <tr key={item.id} className="bg-white hover:bg-gray-50/80">
                            <td className="px-4 py-3 align-top">
                              <div className="font-medium text-gray-900">
                                {item.raw_material?.nama || item.product?.nama || "-"}
                              </div>
                              <div className="text-xs text-gray-500">
                                {item.raw_material?.kode || item.product?.kode || "-"}
                              </div>
                              {(item.batch_number || item.expiry_date) && (
                                <div className="mt-1 text-xs text-gray-500">
                                  Batch {item.batch_number || "-"}
                                  {item.expiry_date
                                    ? ` · kedaluwarsa ${new Date(item.expiry_date).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}`
                                    : ""}
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-3 text-center align-middle text-gray-700">
                              {item.satuan?.nama ||
                                item.purchase_order_item?.satuan?.nama ||
                                item.raw_material?.satuan_besar?.nama ||
                                "-"}
                            </td>
                            <td className="px-2 py-3 text-center align-middle text-gray-700">
                              {formatNumber(item.purchase_order_item?.qty_ordered)}
                            </td>
                            <td className="px-2 py-3 text-center align-middle font-semibold text-emerald-700">
                              {formatNumber(item.qty_diterima)}
                            </td>
                            <td className="px-2 py-3 text-center align-middle font-semibold text-red-600">
                              {formatNumber(item.qty_ditolak)}
                            </td>
                            <td className="px-2 py-3 text-right align-middle text-gray-700">
                              {formatCurrency(item.purchase_order_item?.harga_satuan)}
                            </td>
                            <td className="px-4 py-3 align-top text-gray-600">{item.catatan || "-"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>

          {vendorCredits.length > 0 && (
            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Banknote className="h-4 w-4 text-pink-600" />
                  Vendor Credit
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-4">
                <p className="text-xs leading-5 text-gray-600">
                  Catatan otomatis dari qty tolak pintu atau QC. Kredit ini tidak
                  disetujui dari sini — tagihan memakai sisa qty PO (qty pesan − qty
                  lolos QC). Tutup PO jika supplier tidak mengganti kekurangan.
                </p>
                {vendorCredits.map((credit) => {
                  const isRejectCredit =
                    credit.source_type === "receive_reject" ||
                    credit.source_type === "qc_reject";
                  return (
                    <div
                      key={credit.id}
                      className="rounded-xl border border-gray-200/70 bg-gray-50/50 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-gray-900">{credit.credit_number}</div>
                          <div className="mt-1 text-xs text-gray-500">
                            {CREDIT_SOURCE_LABELS[credit.source_type] || credit.source_type}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={
                              CREDIT_STATUS_STYLES[credit.status] ||
                              "border-gray-200 bg-gray-50 text-gray-700"
                            }
                          >
                            {CREDIT_STATUS_LABELS[credit.status] ||
                              credit.status.replace(/_/g, " ")}
                          </Badge>
                          <span className="text-sm font-semibold text-gray-900">
                            {formatCurrency(credit.total_amount)}
                          </span>
                        </div>
                      </div>
                      {(credit.items || []).length > 0 && (
                        <ul className="mt-3 space-y-1 text-xs text-gray-600">
                          {credit.items?.map((line) => (
                            <li key={line.id} className="flex justify-between gap-2">
                              <span>
                                {line.raw_material?.nama || line.raw_material?.kode || "Item"} ·{" "}
                                {formatNumber(line.qty)} × {formatCurrency(line.unit_price)}
                              </span>
                              <span className="font-medium text-gray-800">
                                {formatCurrency(line.line_amount)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {isRejectCredit &&
                        (credit.status === "draft" || credit.status === "pending_approval") && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          Persetujuan kredit reject dinonaktifkan. Kekurangan otomatis
                          mengurangi tagihan lewat sisa qty PO.
                        </p>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="xl:col-span-4">
          <Card className="border-gray-200/70 shadow-xs xl:sticky xl:top-6">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="text-base">Ringkasan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <dl className="space-y-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-gray-500">Purchase Order</dt>
                  <dd className="text-right font-medium text-gray-900">{poNumber}</dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-gray-500">{supplierLabel}</dt>
                  <dd className="text-right font-medium text-gray-900">
                    {grn.supplier_name || grn.supplier?.nama_supplier || "-"}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-gray-500">Jumlah Item</dt>
                  <dd className="text-right font-medium text-gray-900">{grn.items?.length || 0}</dd>
                </div>
                <div className="grid grid-cols-2 gap-2 border-t border-gray-200/70 pt-3">
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
                    <p className="text-xs text-emerald-700">Baik</p>
                    <p className="mt-1 text-sm font-semibold text-emerald-800">{formatNumber(totalAccepted)}</p>
                  </div>
                  <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2">
                    <p className="text-xs text-red-700">Tolak</p>
                    <p className="mt-1 text-sm font-semibold text-red-700">{formatNumber(totalRejected)}</p>
                  </div>
                </div>
                <div className="flex items-start justify-between gap-3 border-t border-gray-200/70 pt-3">
                  <dt className="font-medium text-gray-900">Tingkat Penerimaan</dt>
                  <dd className="text-right font-semibold text-gray-900">{acceptedPct}%</dd>
                </div>
              </dl>

              <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900">
                  <ClipboardCheck className="h-4 w-4 text-pink-600" />
                  Quality Control
                </div>
                {!qc ? (
                  <div className="space-y-3">
                    <p className="text-xs leading-5 text-gray-600">
                      Belum ada inspeksi QC. Selesaikan QC untuk memposting qty lolos ke stok.
                    </p>
                    {canRunQc && (
                      <Link
                        href={
                          isProduct
                            ? PRODUCT_ROUTES.purchasingReceiveQc(grn.id)
                            : RM_ROUTES.purchasingGrnQc(grn.id)
                        }
                      >
                        <Button size="sm" className="purchasing-main-button h-8">
                          <ClipboardCheck className="mr-2 h-3.5 w-3.5" />
                          Mulai Inspeksi
                        </Button>
                      </Link>
                    )}
                  </div>
                ) : (
                  <dl className="space-y-2 text-xs text-gray-600">
                    <div className="flex items-start justify-between gap-3">
                      <dt>Status</dt>
                      <dd className="text-right font-medium text-gray-900">
                        {QC_STATUS_LABELS[String(qc.status || qc.hasil || "").toLowerCase()] ||
                          qc.status ||
                          qc.hasil ||
                          "-"}
                      </dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt>Inspektor</dt>
                      <dd className="text-right font-medium text-gray-900">
                        {qc.inspected_by_user?.email || qc.inspector?.email || qc.inspector?.name || "-"}
                      </dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt>Tanggal Inspeksi</dt>
                      <dd className="text-right font-medium text-gray-900">
                        {formatDate(qc.inspected_at || qc.tanggal_inspeksi)}
                      </dd>
                    </div>
                    {(qc.catatan_qc || qc.catatan) && (
                      <div>
                        <dt className="mb-1">Catatan</dt>
                        <dd className="rounded-lg border border-gray-200/70 bg-white px-3 py-2 text-gray-700">
                          {qc.catatan_qc || qc.catatan}
                        </dd>
                      </div>
                    )}
                    <p
                      className={`pt-1 font-medium ${
                        qcStatus.includes("reject") ? "text-red-600" : "text-emerald-600"
                      }`}
                    >
                      {qcStatus.includes("reject") ? "QC menemukan masalah" : "QC selesai"}
                    </p>
                  </dl>
                )}
              </div>

              <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900">
                  <Info className="h-4 w-4 text-pink-600" />
                  Kontak {supplierLabel}
                </div>
                <dl className="space-y-2 text-xs text-gray-600">
                  <div className="flex items-start justify-between gap-3">
                    <dt>Email</dt>
                    <dd className="text-right font-medium text-gray-900">{grn.supplier?.email || "-"}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt>Telepon</dt>
                    <dd className="text-right font-medium text-gray-900">{grn.supplier?.telepon || "-"}</dd>
                  </div>
                </dl>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
