"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ClipboardCheck, FileText, Loader2Icon, Printer, TruckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PurchasingFormHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { formatDate } from "@/lib/format";
import { PRODUCT_ROUTES, RM_ROUTES } from "@/lib/purchasing/item-routes";
import type { PurchasingModuleType } from "../api";
import { useGrn, useGrnQC, useGrnVendorCredits } from "../queries";
import type { GrnDetail, GrnQcInspection } from "../types";
import { GrnItemsCard, GrnVendorCreditsCard } from "./grn-detail-items";
import { GrnDetailSummary } from "./grn-detail-summary";

const GRN_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "Menunggu QC", className: "border-slate-200 bg-slate-100 text-slate-700" },
  partially_received: { label: "Diterima Sebagian", className: "border-amber-200 bg-amber-50 text-amber-700" },
  received: { label: "Diterima Penuh", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  rejected: { label: "Ditolak", className: "border-red-200 bg-red-50 text-red-700" },
};

function DetailField({ label, value, href, className }: { label: string; value: string; href?: string; className?: string }) {
  const content = (
    <div className={className}>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={`mt-0.5 text-sm font-medium text-gray-900 ${href ? "text-pink-700 hover:underline" : ""}`}>{value}</dd>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

function InfoCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 p-4 md:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

export function GRNDetailPage({ moduleType = "raw_material" }: { moduleType?: PurchasingModuleType }) {
  const isProduct = moduleType === "product";
  const listRoute = isProduct ? PRODUCT_ROUTES.purchasingReceive : RM_ROUTES.purchasingGrn;
  const supplierLabel = isProduct ? "Vendor" : "Supplier";

  const grnId = useParams().id as string;
  const grnQuery = useGrn<GrnDetail>(grnId);
  const qcQuery = useGrnQC<GrnQcInspection>(grnId);
  const creditsQuery = useGrnVendorCredits(grnId);
  const grn = grnQuery.data;
  const qc = qcQuery.data ?? null;

  if (grnQuery.isLoading) {
    return (
      <div className="flex min-h-56 items-center justify-center text-sm text-gray-500">
        <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
        Memuat detail GRN...
      </div>
    );
  }

  if (!grn) {
    return (
      <div className="space-y-4">
        <PurchasingFormHeader backHref={listRoute} title="Detail GRN" />
        <Card className={grnQuery.isError ? "border-red-100" : "border-gray-200/70"}>
          <CardContent className="py-12 text-center">
            {grnQuery.isError ? (
              <>
                <p className="font-medium text-red-700">Gagal memuat detail GRN</p>
                <p className="mt-2 text-sm text-red-600">
                  {grnQuery.error instanceof Error ? grnQuery.error.message : "Terjadi kesalahan"}
                </p>
              </>
            ) : (
              <p className="text-gray-500">GRN tidak ditemukan.</p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const poId = grn.purchase_order?.id || grn.purchase_order_id;
  const poNumber = grn.po_number || grn.purchase_order?.nomor_po || "-";
  const status = GRN_STATUS[String(grn.status || "").toLowerCase()];
  const qcHref =
    grn.status === "pending" && !qc?.inventory_posted
      ? isProduct
        ? PRODUCT_ROUTES.purchasingReceiveQc(grn.id)
        : RM_ROUTES.purchasingGrnQc(grn.id)
      : null;
  // Sisa PO tidak dilanjutkan di GRN yang sama: buat pengiriman baru.
  const reshipHref =
    grn.status === "partially_received" && poId
      ? isProduct
        ? `${PRODUCT_ROUTES.purchasingDeliveryInsert}?po_id=${poId}`
        : `${RM_ROUTES.purchasingDelivery}/insert?po_id=${poId}`
      : null;

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={listRoute}
        title={grn.nomor_grn || "-"}
        description={`Purchase Order ${poNumber} · ${formatDate(grn.tanggal_penerimaan)}${grn.supplier_name ? ` · ${grn.supplier_name}` : ""}`}
        actions={
          <>
            <Badge variant="outline" className={status?.className || "border-gray-200 bg-gray-100 text-gray-800"}>
              {status?.label || grn.status || "-"}
            </Badge>
            <Button variant="outline" onClick={() => window.print()} className="purchasing-secondary-button w-full sm:w-auto">
              <Printer className="mr-2 h-4 w-4" />
              Cetak
            </Button>
            {qcHref && (
              <Link href={qcHref}>
                <Button className="purchasing-main-button w-full sm:w-auto">
                  <ClipboardCheck className="mr-2 h-4 w-4" />
                  Jalankan QC
                </Button>
              </Link>
            )}
            {reshipHref && (
              <Link href={reshipHref}>
                <Button className="purchasing-main-button w-full sm:w-auto">
                  <TruckIcon className="mr-2 h-4 w-4" />
                  Kirim Ulang
                </Button>
              </Link>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-8">
          <InfoCard icon={<FileText className="h-4 w-4 text-pink-600" />} title="Informasi Penerimaan">
            <DetailField label="No. GRN" value={grn.nomor_grn || "-"} />
            <DetailField label="Tanggal Penerimaan" value={formatDate(grn.tanggal_penerimaan)} />
            <DetailField
              label="Purchase Order"
              value={poNumber}
              href={poId ? (isProduct ? PRODUCT_ROUTES.purchasingPoDetail(poId) : `/dashboard/purchasing/po/${poId}`) : undefined}
            />
            <DetailField label="No. Surat Jalan" value={grn.no_surat_jalan || grn.delivery?.no_surat_jalan || "-"} />
            <DetailField label={supplierLabel} value={grn.supplier_name || grn.supplier?.nama_supplier || "-"} />
            <DetailField label={`Kode ${supplierLabel}`} value={grn.supplier?.kode || "-"} />
            <DetailField label="Catatan" value={grn.catatan || "-"} className="md:col-span-2" />
          </InfoCard>

          {grn.delivery_id && (
            <InfoCard icon={<TruckIcon className="h-4 w-4 text-pink-600" />} title="Informasi Pengiriman">
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
            </InfoCard>
          )}

          <GrnItemsCard items={grn.items ?? []} itemColumnLabel={isProduct ? "Produk" : "Bahan Baku"} />
          <GrnVendorCreditsCard credits={creditsQuery.data ?? []} />
        </div>

        <div className="xl:col-span-4">
          <GrnDetailSummary grn={grn} qc={qc} poNumber={poNumber} supplierLabel={supplierLabel} qcHref={qcHref} />
        </div>
      </div>
    </div>
  );
}
