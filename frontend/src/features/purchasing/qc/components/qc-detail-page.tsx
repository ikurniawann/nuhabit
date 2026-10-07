"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQC } from "../queries";
import { QCNotFoundError } from "../api";
import {
  QC_HASIL_COLORS,
  QC_HASIL_LABELS,
  formatQcMaterialsSummary,
  getQcDisplayNumber,
  getQcGrnId,
  getQcItemMaterialLabel,
  getQcTotals,
} from "../types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BeakerIcon,
  CheckCircleIcon,
  XCircleIcon,
  CalendarIcon,
  UserIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";
import { CheckCircleIcon as CheckCircleSolid } from "@heroicons/react/24/solid";
import { ArrowLeft, ClipboardCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { formatDate, formatDateLong, formatTime } from "@/lib/format";

const REKOMENDASI_COLORS: Record<string, string> = {
  ACCEPT: "text-green-700 bg-green-50",
  REJECT: "text-red-700 bg-red-50",
  REWORK: "text-yellow-700 bg-yellow-50",
};

function statusIcon(hasil: string) {
  const className = "mr-1.5 h-4 w-4";
  if (hasil === "approved" || hasil === "passed") return <CheckCircleSolid className={className} />;
  if (hasil === "rejected") return <XCircleIcon className={className} />;
  return <AlertTriangle className={className} />;
}

export function QCDetailPage() {
  const params = useParams();
  const router = useRouter();
  const qcId = params.id as string;

  const detailQuery = useQC(qcId);
  const qc = detailQuery.data ?? null;
  const loading = detailQuery.isLoading;

  useEffect(() => {
    if (!detailQuery.isError) return;
    const error = detailQuery.error;
    if (error instanceof QCNotFoundError) {
      toast.error("Data QC tidak ditemukan");
      router.push("/dashboard/purchasing/qc");
      return;
    }
    toast.error(error instanceof Error ? error.message : "Terjadi kesalahan");
  }, [detailQuery.isError, detailQuery.error, router]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="py-12 text-center text-gray-500">Memuat data QC...</div>
      </div>
    );
  }

  if (!qc) {
    return null;
  }

  const hasilKey = String(qc.hasil || qc.status || "partial").toLowerCase();
  const totals = getQcTotals(qc);
  const grnId = getQcGrnId(qc);
  const items = qc.items || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{getQcDisplayNumber(qc)}</h1>
            <Badge
              className={`${QC_HASIL_COLORS[hasilKey] || "bg-gray-100 text-gray-800"} border px-3 py-1.5 text-sm font-medium`}
            >
              {statusIcon(hasilKey)}
              {QC_HASIL_LABELS[hasilKey] || hasilKey}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <span>{formatQcMaterialsSummary(items)}</span>
            <span className="text-gray-300">•</span>
            <span>GRN {qc.grn_number || "—"}</span>
            {qc.rekomendasi && (
              <>
                <span className="text-gray-300">•</span>
                <span>{qc.rekomendasi}</span>
              </>
            )}
          </div>
        </div>
        <Link href="/dashboard/purchasing/qc" className="w-full sm:w-auto">
          <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Kembali
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5" />
              Informasi Inspeksi
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm text-gray-500">Nomor GRN</label>
                <div className="font-medium text-gray-900">{qc.grn_number || "—"}</div>
              </div>
              <div>
                <label className="text-sm text-gray-500">Inspektur</label>
                <div className="font-medium text-gray-900">
                  {qc.inspector?.name || qc.inspector_id?.slice(0, 8) || "—"}
                </div>
              </div>
            </div>

            {grnId && (
              <div>
                <label className="text-sm text-gray-500">Goods Receipt</label>
                <div>
                  <Link
                    href={`/dashboard/purchasing/grn/${grnId}`}
                    className="font-medium text-pink-600 hover:text-pink-700 hover:underline"
                  >
                    Buka detail GRN
                  </Link>
                </div>
              </div>
            )}

            <div className="border-t border-gray-200/70 pt-4">
              <h3 className="mb-3 font-semibold text-gray-900">Ringkasan Hasil</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg bg-gray-50 p-3 text-center">
                  <div className="text-sm text-gray-500">Diperiksa</div>
                  <div className="text-2xl font-bold text-gray-900">{totals.inspected}</div>
                </div>
                <div className="rounded-lg bg-green-50 p-3 text-center">
                  <div className="text-sm text-green-600">Diterima</div>
                  <div className="text-2xl font-bold text-green-700">{totals.accepted}</div>
                </div>
                <div className="rounded-lg bg-red-50 p-3 text-center">
                  <div className="text-sm text-red-600">Ditolak</div>
                  <div className="text-2xl font-bold text-red-700">{totals.rejected}</div>
                </div>
              </div>
            </div>

            {items.length > 0 && (
              <div className="border-t border-gray-200/70 pt-4">
                <h3 className="mb-3 font-semibold text-gray-900">Item Inspeksi</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="border-b border-gray-200/70 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        {["Bahan Baku", "Diperiksa", "Diterima", "Ditolak"].map((h) => (
                          <th key={h} className="px-3 py-2 text-left font-semibold">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200/70">
                      {items.map((item, index) => (
                        <tr key={`${item.raw_material_id || item.bahan_baku_id || index}`}>
                          <td className="px-3 py-2 font-medium text-gray-900">
                            {getQcItemMaterialLabel(item)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {item.jumlah_diperiksa ?? item.qty_inspected ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-center text-green-700">
                            {item.jumlah_diterima ?? item.qty_accepted ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-center text-red-600">
                            {item.jumlah_ditolak ?? item.qty_rejected ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {qc.parameter_inspeksi && Object.keys(qc.parameter_inspeksi).length > 0 && (
              <div className="border-t border-gray-200/70 pt-4">
                <h3 className="mb-3 font-semibold text-gray-900">Parameter Inspeksi</h3>
                <div className="space-y-2">
                  {Object.entries(qc.parameter_inspeksi).map(([param, value]) => (
                    <div
                      key={param}
                      className="flex items-center justify-between rounded-lg bg-gray-50 p-2.5"
                    >
                      <span className="text-sm font-medium text-gray-700">{param}</span>
                      <Badge
                        variant={value === "OK" ? "default" : "destructive"}
                        className={
                          value === "OK"
                            ? "bg-green-100 text-green-800"
                            : value === "NG"
                              ? "bg-red-100 text-red-800"
                              : "bg-gray-100 text-gray-800"
                        }
                      >
                        {value === "OK" && <CheckCircleIcon className="mr-1 h-3 w-3" />}
                        {value === "NG" && <XCircleIcon className="mr-1 h-3 w-3" />}
                        {value}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {qc.catatan && (
              <div className="border-t border-gray-200/70 pt-4">
                <h3 className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                  <DocumentTextIcon className="h-4 w-4" />
                  Catatan QC
                </h3>
                <div className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                  {qc.catatan}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ringkasan Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Status Hasil</span>
                <Badge className={`${QC_HASIL_COLORS[hasilKey] || "bg-gray-100"} border`}>
                  {QC_HASIL_LABELS[hasilKey] || hasilKey}
                </Badge>
              </div>
              {qc.rekomendasi && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Rekomendasi</span>
                  <span
                    className={`rounded px-2 py-1 text-sm font-medium ${REKOMENDASI_COLORS[qc.rekomendasi] || "bg-gray-50 text-gray-700"}`}
                  >
                    {qc.rekomendasi}
                  </span>
                </div>
              )}
              <div className="border-t border-gray-200/70 pt-3">
                <div className="mb-2 text-xs text-gray-500">Persentase Diterima</div>
                <div className="h-2.5 w-full rounded-full bg-gray-200">
                  <div
                    className="h-2.5 rounded-full bg-green-600 transition-all"
                    style={{
                      width: `${totals.inspected > 0 ? (totals.accepted / totals.inspected) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className="mt-1 text-right text-xs text-gray-600">
                  {totals.inspected > 0
                    ? Math.round((totals.accepted / totals.inspected) * 100)
                    : 0}
                  %
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <CalendarIcon className="mt-0.5 h-4 w-4 text-gray-400" />
                <div>
                  <div className="text-xs text-gray-500">Tanggal Inspeksi</div>
                  <div className="text-sm font-medium">
                    {formatDateLong(qc.tanggal_inspeksi)}, {formatTime(qc.tanggal_inspeksi)}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <UserIcon className="mt-0.5 h-4 w-4 text-gray-400" />
                <div>
                  <div className="text-xs text-gray-500">Inspektur</div>
                  <div className="text-sm font-medium">
                    {qc.inspector?.name || qc.inspector_id?.slice(0, 8) || "—"}
                  </div>
                  {qc.inspector?.email && (
                    <div className="text-xs text-gray-500">{qc.inspector.email}</div>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-3">
                <BeakerIcon className="mt-0.5 h-4 w-4 text-gray-400" />
                <div>
                  <div className="text-xs text-gray-500">Dibuat</div>
                  <div className="text-sm font-medium">
                    {formatDate(qc.created_at)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {grnId && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <Link href={`/dashboard/purchasing/grn/${grnId}`} className="block">
                  <Button variant="outline" className="w-full justify-start">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Lihat GRN
                  </Button>
                </Link>
                <Link href="/dashboard/purchasing/qc" className="block">
                  <Button variant="ghost" className="w-full justify-start">
                    Kembali ke Daftar QC
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
