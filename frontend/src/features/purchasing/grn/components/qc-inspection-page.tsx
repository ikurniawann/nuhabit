"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PurchasingFormFooter,
  PurchasingFormHeader,
} from "@/features/purchasing/components/shared/purchasing-page-header";
import { formatDate, formatNumber } from "@/lib/format";
import {
  buildQcPayload,
  initialQcResults,
  qcLinesFromGrnItems,
  qcOverallStatus,
  qcParameterSummary,
  qcTotals,
  updateQcLine,
  validateQcLines,
  type QcLineChange,
} from "@/lib/purchasing/grn-ui-qc";
import { PRODUCT_ROUTES, RM_ROUTES } from "@/lib/purchasing/item-routes";
import type { PurchasingModuleType } from "../api";
import { useCreateQCInspection } from "../mutations";
import { useGrn, useGrnQC } from "../queries";
import type { GrnDetail, GrnQcInspection } from "../types";
import { QcItemsCard, QcParametersCard } from "./qc-inspection-items";
import { QcSummaryCards } from "./qc-inspection-summary";

export function QCInspectionPage({ moduleType = "raw_material" }: { moduleType?: PurchasingModuleType }) {
  const isProduct = moduleType === "product";
  const listRoute = isProduct ? PRODUCT_ROUTES.purchasingReceive : RM_ROUTES.purchasingGrn;
  const detailRoute = isProduct ? PRODUCT_ROUTES.purchasingReceiveDetail : RM_ROUTES.purchasingGrnDetail;

  const grnId = useParams().id as string;
  const grnQuery = useGrn<GrnDetail>(grnId);
  const qcQuery = useGrnQC<GrnQcInspection>(grnId);

  useEffect(() => {
    if (grnQuery.isError) toast.error("Gagal memuat data GRN");
  }, [grnQuery.isError]);

  if (grnQuery.isLoading || qcQuery.isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center text-sm text-gray-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-pink-600" />
        Memuat workspace QC...
      </div>
    );
  }

  const grn = grnQuery.data;
  if (!grn) {
    return (
      <div className="space-y-4">
        <PurchasingFormHeader backHref={listRoute} title="Inspeksi QC" description="GRN tidak ditemukan" />
        <Card className="border-gray-200/70">
          <CardContent className="py-12 text-center text-gray-500">Gagal memuat data GRN.</CardContent>
        </Card>
      </div>
    );
  }

  return <QcInspectionForm key={grn.id} grn={grn} existingQc={qcQuery.data ?? null} detailHref={detailRoute(grn.id)} />;
}

type FormProps = {
  grn: GrnDetail;
  existingQc: GrnQcInspection | null;
  detailHref: string;
};

/** Form inspeksi; baris diisi dari item GRN saat mount (induk memberi `key`). */
function QcInspectionForm({ grn, existingQc, detailHref }: FormProps) {
  const router = useRouter();
  const qcMutation = useCreateQCInspection();
  const saving = qcMutation.isPending;

  const [lines, setLines] = useState(() => qcLinesFromGrnItems(grn.items));
  const [results, setResults] = useState(initialQcResults);
  const [catatan, setCatatan] = useState("");

  const qcLocked = existingQc?.inventory_posted === true || Boolean(grn.status && grn.status !== "pending");
  const disabled = qcLocked || saving;

  const changeLine = (grnItemId: string, change: QcLineChange) =>
    setLines((prev) => prev.map((line) => (line.grn_item_id === grnItemId ? updateQcLine(line, change) : line)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (qcLocked) {
      toast.error("QC untuk GRN ini sudah selesai");
      return;
    }
    const error = validateQcLines(lines);
    if (error) {
      toast.error(error);
      return;
    }
    try {
      await qcMutation.mutateAsync({ grnId: grn.id, payload: buildQcPayload(lines, results, catatan) });
      toast.success("QC selesai. Stok sudah diperbarui.");
      router.push(detailHref);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengirim hasil QC");
    }
  };

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={detailHref}
        title="Inspeksi QC"
        description={
          <>
            Inspeksi barang diterima untuk <span className="font-medium text-gray-700">{grn.nomor_grn}</span> sebelum
            stok diposting ke inventory.
          </>
        }
        actions={
          qcLocked ? (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
              QC Selesai
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
              Menunggu Inspeksi
            </Badge>
          )
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          { label: "Tanggal Penerimaan", value: formatDate(grn.tanggal_penerimaan) },
          { label: "Purchase Order", value: grn.po_number || "-" },
          { label: "Qty Baik Diterima", value: formatNumber(grn.total_item_diterima, 4) },
        ].map((tile) => (
          <Card key={tile.label} className="border-gray-200/70 shadow-xs">
            <CardContent className="space-y-1 p-4">
              <p className="text-xs text-gray-500">{tile.label}</p>
              <p className="text-sm font-medium text-gray-900">{tile.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {qcLocked && (
        <Card className="border-emerald-200/80 bg-emerald-50/50">
          <CardContent className="flex items-start gap-3 p-4 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Inspeksi sudah selesai</p>
              <p className="mt-1 text-emerald-700/90">
                Stok diposting pada {formatDate(existingQc?.inspected_at)}. Lihat detail GRN untuk hasil akhir.
              </p>
              <Link href={detailHref} className="mt-2 inline-block">
                <Button variant="outline" size="sm" className="purchasing-secondary-button">
                  Lihat Detail GRN
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      <form id="grn-qc-form" onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-8">
            <QcItemsCard lines={lines} disabled={disabled} onChange={changeLine} />
            <QcParametersCard
              results={results}
              disabled={disabled}
              onChange={(param, value) => setResults((prev) => ({ ...prev, [param]: value }))}
            />
            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="text-base">Catatan</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <Label htmlFor="qc-notes" className="sr-only">
                  Catatan QC
                </Label>
                <Textarea
                  id="qc-notes"
                  value={catatan}
                  onChange={(e) => setCatatan(e.target.value)}
                  placeholder="Tambahkan catatan inspeksi, cacat yang ditemukan, atau tindak lanjut..."
                  rows={4}
                  disabled={disabled}
                  className="border-gray-200/80"
                />
              </CardContent>
            </Card>
          </div>

          <QcSummaryCards status={qcOverallStatus(lines)} totals={qcTotals(lines)} parameters={qcParameterSummary(results)} />
        </div>

        {!qcLocked && (
          <PurchasingFormFooter
            formId="grn-qc-form"
            onCancel={() => router.push(detailHref)}
            submitLabel="Selesaikan QC"
            loading={saving}
            disabled={lines.length === 0}
          />
        )}
      </form>
    </div>
  );
}
