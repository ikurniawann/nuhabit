"use client";

import { use } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeftIcon,
  ClipboardList,
  FileText,
  Loader2,
  Pencil,
  Printer,
  XCircle,
} from "lucide-react";
import { getPRStatusLabel, getPriorityBadge } from "@/lib/purchasing/status-labels";
import { PRRevisionButton } from "@/features/purchasing/components/shared/pr-revision-button";
import { PRDetailToast } from "@/features/purchasing/components/shared/pr-detail-toast";
import { PRApprovalActions } from "@/features/purchasing/components/shared/pr-approval-actions";
import { GENERAL_ROUTES } from "@/lib/purchasing/item-routes";
import { NAV_FROM_APPROVAL_PR, appendNavFrom } from "@/lib/iam/nav-context";
import { useNavFrom } from "@/lib/iam/use-nav-from";
import { useGeneralPurchaseRequest } from "../queries";
import type { GeneralPRDetailItem } from "../types";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";

const PR_STATUS_LABEL_OVERRIDES: Record<string, string> = {
  rejected: "Ditolak",
  converted: "Purchase Order Dibuat",
};

const PR_STATUS_STYLES: Record<string, string> = {
  draft: "border-gray-200 bg-gray-50 text-gray-700",
  pending_head: "border-amber-200 bg-amber-50 text-amber-700",
  pending_finance: "border-orange-200 bg-orange-50 text-orange-700",
  pending_direksi: "border-orange-200 bg-orange-50 text-orange-700",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-red-200 bg-red-50 text-red-700",
  converted: "border-blue-200 bg-blue-50 text-blue-700",
};

const PRIORITY_STYLES: Record<string, string> = {
  low: "border-gray-200 bg-gray-50 text-gray-600",
  medium: "border-blue-200 bg-blue-50 text-blue-700",
  high: "border-orange-200 bg-orange-50 text-orange-700",
  urgent: "border-red-200 bg-red-50 text-red-700",
};

const PRIORITY_LABEL_OVERRIDES: Record<string, string> = {
  low: "Rendah",
  medium: "Sedang",
  high: "Tinggi",
  urgent: "Mendesak",
};

type GeneralPRDetailPageProps = {
  params: Promise<{ id: string }>;
};

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-gray-900">{value}</dd>
    </div>
  );
}

export function GeneralPRDetailPage({ params }: GeneralPRDetailPageProps) {
  const { id } = use(params);
  const navFrom = useNavFrom();
  const fromApproval = navFrom === NAV_FROM_APPROVAL_PR;
  const backHref = fromApproval ? GENERAL_ROUTES.approvalPr : GENERAL_ROUTES.purchasingPr;
  const backLabel = fromApproval ? "Kembali ke Approval" : "Kembali";
  const editHref = fromApproval
    ? appendNavFrom(GENERAL_ROUTES.purchasingPrEdit(id), NAV_FROM_APPROVAL_PR)
    : GENERAL_ROUTES.purchasingPrEdit(id);
  const { data: pr, isLoading, isError, error } = useGeneralPurchaseRequest(id);

  if (isLoading) {
    return (
      <div className="flex min-h-56 items-center justify-center text-sm text-gray-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-pink-600" />
        Memuat permintaan barang...
      </div>
    );
  }

  if (isError || !pr) {
    return (
      <div className="space-y-4">
        <Link href={backHref}>
          <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
            <ArrowLeftIcon className="h-4 w-4" />
            {backLabel}
          </Button>
        </Link>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="py-12 text-center text-sm text-gray-500">
            {error instanceof Error ? error.message : "Permintaan barang tidak ditemukan atau gagal dimuat."}
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusBadge = getPRStatusLabel(pr.status);
  const priorityBadge = getPriorityBadge(pr.priority);
  const statusLabel = PR_STATUS_LABEL_OVERRIDES[pr.status] ?? statusBadge.label;
  const priorityLabel = PRIORITY_LABEL_OVERRIDES[pr.priority] ?? priorityBadge.label;
  const statusStyle = PR_STATUS_STYLES[pr.status] ?? "border-gray-200 bg-gray-50 text-gray-700";
  const priorityStyle = PRIORITY_STYLES[pr.priority] ?? "border-gray-200 bg-gray-50 text-gray-700";
  const requesterName = pr.requester_name || "-";
  const { canApprove, canCreatePO } = pr.permissions;
  const itemCount = pr.items?.length ?? 0;
  const totalQty = pr.items?.reduce((sum, item) => sum + Number(item.qty || 0), 0) ?? 0;

  return (
    <div className="space-y-6">
      <PRDetailToast />

      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Link href={backHref}>
            <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
              <ArrowLeftIcon className="h-4 w-4" />
              {backLabel}
            </Button>
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{pr.pr_number}</h1>
              <Badge variant="outline" className={statusStyle}>
                {statusLabel}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {formatDate(pr.created_at)} · {requesterName} · Prioritas {priorityLabel}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {pr.status === "draft" && pr.permissions.canEdit && (
            <Link href={editHref}>
              <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
                <Pencil className="mr-2 h-4 w-4" />
                Ubah
              </Button>
            </Link>
          )}
          {pr.status === "rejected" && <PRRevisionButton prId={id} />}
          <Link href={`/dashboard/purchasing/print/pr/${id}`} target="_blank">
            <Button variant="outline" className="purchasing-secondary-button w-full cursor-pointer sm:w-auto">
              <Printer className="mr-2 h-4 w-4" />
              Cetak
            </Button>
          </Link>
          {canCreatePO && (
            <Link href={`${GENERAL_ROUTES.purchasingPoInsert}?pr_id=${id}`}>
              <Button className="purchasing-main-button w-full sm:w-auto">
                <FileText className="mr-2 h-4 w-4" />
                Buat Purchase Order
              </Button>
            </Link>
          )}
          {pr.status === "converted" && pr.converted_po_id && (
            <Link href={GENERAL_ROUTES.purchasingPoDetail(pr.converted_po_id)}>
              <Button className="purchasing-main-button w-full sm:w-auto">
                <FileText className="mr-2 h-4 w-4" />
                Lihat Purchase Order
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
                <ClipboardList className="h-4 w-4 text-pink-600" />
                Informasi Permintaan
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 p-4 md:grid-cols-2">
              <DetailField label="Departemen" value={pr.department?.name || pr.department_name || "-"} />
              <DetailField label="Pemohon" value={requesterName} />
              <DetailField
                label="Tanggal Dibutuhkan"
                value={pr.required_date ? formatDate(pr.required_date) : "-"}
              />
              <div>
                <dt className="text-xs text-gray-500">Prioritas</dt>
                <dd className="mt-1">
                  <Badge variant="outline" className={priorityStyle}>
                    {priorityLabel}
                  </Badge>
                </dd>
              </div>
              {pr.notes && (
                <div className="md:col-span-2 border-t border-gray-200/70 pt-4">
                  <p className="text-xs font-medium text-gray-500">Catatan</p>
                  <p className="mt-1 text-sm text-gray-700">{pr.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-pink-600" />
                Item Diminta
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!pr.items?.length ? (
                <div className="py-12 text-center text-sm text-gray-500">Tidak ada item.</div>
              ) : (
                <div className="overflow-x-auto p-4">
                  <table className="min-w-full text-sm">
                    <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold">#</th>
                        <th className="px-4 py-3 text-left font-semibold">Barang</th>
                        <th className="px-4 py-3 text-right font-semibold">Jumlah</th>
                        <th className="px-4 py-3 text-center font-semibold">Satuan</th>
                        <th className="px-4 py-3 text-right font-semibold">Est. Harga Satuan</th>
                        <th className="px-4 py-3 text-right font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pr.items.map((item: GeneralPRDetailItem, index: number) => (
                        <tr key={item.id} className="hover:bg-gray-50/80">
                          <td className="px-4 py-3 text-gray-500">{index + 1}</td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">
                              {item.supply_item?.nama || item.description || "-"}
                            </div>
                            {item.supply_item?.kode && (
                              <div className="text-xs text-gray-500">{item.supply_item.kode}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-700">{formatNumber(item.qty, 4)}</td>
                          <td className="px-4 py-3 text-center text-gray-600">
                            {item.satuan?.nama || item.unit || "-"}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-700">
                            {formatRupiah(item.estimated_price || 0)}
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-gray-900">
                            {formatRupiah(item.total || 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 xl:col-span-4">
          {canApprove && <PRApprovalActions prId={id} />}
          <Card className="border-gray-200/70 shadow-xs xl:sticky xl:top-6">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="text-base">Ringkasan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <dl className="space-y-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-gray-500">Jumlah Item</dt>
                  <dd className="font-medium text-gray-900">{itemCount}</dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-gray-500">Total Kuantitas</dt>
                  <dd className="font-medium text-gray-900">{formatNumber(totalQty, 4)}</dd>
                </div>
                <div className="flex items-start justify-between gap-3 border-t border-gray-200/70 pt-3">
                  <dt className="font-medium text-gray-900">Estimasi Total</dt>
                  <dd className="font-semibold text-pink-700">{formatRupiah(pr.total_amount)}</dd>
                </div>
              </dl>
              {pr.status === "rejected" && pr.rejection_reason && (
                <div className="rounded-xl border border-red-200/80 bg-red-50/60 p-4 text-sm text-red-900">
                  <p className="flex items-center gap-1.5 font-medium">
                    <XCircle className="h-4 w-4" />
                    Alasan penolakan
                  </p>
                  <p className="mt-1 text-red-800/90">{pr.rejection_reason}</p>
                </div>
              )}
              {pr.status === "pending_head" && (
                <div className="rounded-xl border border-blue-200/80 bg-blue-50/60 p-4 text-sm text-blue-900">
                  <p className="font-medium">Menunggu persetujuan</p>
                  <p className="mt-1 text-blue-800/90">
                    Permintaan ini menunggu persetujuan item dan kuantitas.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
