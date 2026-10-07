"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, TruckIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DsDateTimePicker } from "@/components/design-system";
import {
  PurchasingFormFooter,
  PurchasingFormHeader,
} from "@/features/purchasing/components/shared/purchasing-page-header";
import { formatNumber } from "@/lib/format";
import {
  applyContinueGoodQty,
  buildContinueGrnLines,
  buildContinueGrnPayload,
  findPoLine,
  poRemainingQty,
  type PoLine,
} from "@/lib/purchasing/grn-ui-lines";
import { todayIsoDate } from "@/lib/purchasing/po-ui-detail";
import { useUpdateGrn } from "../mutations";
import type { GrnDetail } from "../types";
import { ContinueGrnItemsTable } from "./continue-grn-items-table";
import { GuidelinesBox, InfoField, ItemPreviewBox, SummaryRow } from "./receiving-form-parts";

const GUIDELINES = [
  "Qty baik adalah total yang diterima pada baris GRN ini.",
  "Anda dapat menerima maksimal sisa qty PO (qty outstanding).",
  "Kekurangan vs sisa PO otomatis dipindahkan ke kolom tolak.",
  "Tanggal penerimaan dan catatan dapat diubah sebelum disimpan.",
];

const GRN_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "Menunggu", className: "border-amber-200 bg-amber-50 text-amber-700" },
  partially_received: { label: "Diterima Sebagian", className: "border-orange-200 bg-orange-50 text-orange-700" },
  received: { label: "Diterima", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  rejected: { label: "Ditolak", className: "border-red-200 bg-red-50 text-red-700" },
};

const qty = (value: number) => formatNumber(value, 4);

type Props = {
  grn: GrnDetail;
  poLines: PoLine[];
  listRoute: string;
  supplierLabel: string;
};

/** Form Lanjutkan GRN; state diisi dari GRN saat mount (induk memberi `key`). */
export function ContinueGrnForm({ grn, poLines, listRoute, supplierLabel }: Props) {
  const router = useRouter();
  const updateMutation = useUpdateGrn();
  const [lines, setLines] = useState(() => buildContinueGrnLines(grn.items ?? [], poLines));
  const [tanggal, setTanggal] = useState(() => grn.tanggal_penerimaan || todayIsoDate());
  const [catatan, setCatatan] = useState(grn.catatan || "");

  const status = GRN_STATUS[grn.status || "pending"] ?? { ...GRN_STATUS.pending, label: grn.status || "" };

  const totals = lines.reduce(
    (acc, line) => {
      const po = findPoLine(line, poLines);
      acc.ordered += po?.qty_ordered ?? 0;
      acc.received += po?.qty_received ?? 0;
      acc.remaining += poRemainingQty(po);
      acc.good += line.qty_diterima;
      acc.rejected += line.qty_ditolak;
      return acc;
    },
    { ordered: 0, received: 0, remaining: 0, good: 0, rejected: 0 }
  );

  const setGoodQty = (index: number, value: number) =>
    setLines((prev) =>
      prev.map((line, i) => (i === index ? applyContinueGoodQty(line, findPoLine(line, poLines), value) : line))
    );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = buildContinueGrnPayload(grn.id, { tanggal_penerimaan: tanggal, catatan }, lines, poLines);
    if (!payload) {
      toast.error("Isi qty untuk minimal satu item.");
      return;
    }
    try {
      await updateMutation.mutateAsync({ id: grn.id, payload });
      toast.success(`GRN ${grn.nomor_grn || ""} berhasil diperbarui.`);
      router.push(listRoute);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memperbarui GRN.");
    }
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={listRoute}
        title="Lanjutkan Penerimaan GRN"
        description="Catat qty tambahan yang diterima untuk sisa item purchase order"
      />

      <form id="continue-grn-form" onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-8">
            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TruckIcon className="h-4 w-4" />
                  Informasi Penerimaan
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <div className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200/70 bg-gray-50/60 p-4 text-sm md:grid-cols-2">
                  <InfoField label="No. GRN">{grn.nomor_grn}</InfoField>
                  <InfoField label="Status">
                    <Badge variant="outline" className={`mt-1 ${status.className}`}>
                      {status.label}
                    </Badge>
                  </InfoField>
                  <InfoField label="Purchase Order">{grn.po_number || "-"}</InfoField>
                  <InfoField label="No. Surat Jalan">{grn.no_surat_jalan || "-"}</InfoField>
                  <InfoField label={supplierLabel} className="md:col-span-2">
                    {grn.supplier_name || "-"}
                  </InfoField>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <DsDateTimePicker
                    label="Tanggal Penerimaan"
                    value={tanggal}
                    onChange={setTanggal}
                    placeholder="Pilih tanggal penerimaan..."
                    dateOnly
                    required
                  />
                  <div className="min-w-0 space-y-1.5 md:col-span-2">
                    <Label htmlFor="catatan" className="text-xs">
                      Catatan
                    </Label>
                    <Textarea
                      id="catatan"
                      value={catatan}
                      onChange={(e) => setCatatan(e.target.value)}
                      placeholder="Tambahkan catatan jika perlu..."
                      rows={3}
                      className="resize-none text-sm"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardCheck className="h-4 w-4" />
                  Konfirmasi Item Diterima
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {lines.length === 0 ? (
                  <div className="py-12 text-center text-sm text-gray-500">Tidak ada item GRN.</div>
                ) : (
                  <ContinueGrnItemsTable lines={lines} poLines={poLines} onGoodQtyChange={setGoodQty} />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="xl:col-span-4">
            <Card className="border-gray-200/70 shadow-xs xl:sticky xl:top-6">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="text-base">Ringkasan</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <dl className="space-y-3 text-sm">
                  <SummaryRow label="Purchase Order">{grn.po_number || "-"}</SummaryRow>
                  <SummaryRow label={supplierLabel}>{grn.supplier_name || "-"}</SummaryRow>
                  <SummaryRow label="Jumlah Item">{lines.length}</SummaryRow>
                  <div className="grid grid-cols-3 gap-2 border-t border-gray-200/70 pt-3">
                    <div className="rounded-lg border border-gray-200/70 bg-gray-50 px-3 py-2">
                      <p className="text-xs text-gray-500">Dipesan</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">{qty(totals.ordered)}</p>
                    </div>
                    <div className="rounded-lg border border-pink-100 bg-pink-50 px-3 py-2">
                      <p className="text-xs text-pink-600">Diterima</p>
                      <p className="mt-1 text-sm font-semibold text-pink-700">{qty(totals.received)}</p>
                    </div>
                    <div className="rounded-lg border border-orange-100 bg-orange-50 px-3 py-2">
                      <p className="text-xs text-orange-600">Sisa</p>
                      <p className="mt-1 text-sm font-semibold text-orange-700">{qty(totals.remaining)}</p>
                    </div>
                  </div>
                  <SummaryRow label="Total Tolak" strong className="border-t border-gray-200/70 pt-3">
                    <span className={totals.rejected > 0 ? "text-red-600" : undefined}>{qty(totals.rejected)}</span>
                  </SummaryRow>
                  <SummaryRow label="Total Baik (penerimaan ini)" strong>
                    {qty(totals.good)}
                  </SummaryRow>
                </dl>
                <GuidelinesBox lines={GUIDELINES} />
                <ItemPreviewBox
                  items={lines.map((line) => ({ key: line.id, name: line.nama_bahan, qty: qty(line.qty_diterima) }))}
                />
              </CardContent>
            </Card>
          </div>
        </div>

        <PurchasingFormFooter
          formId="continue-grn-form"
          onCancel={() => router.push(listRoute)}
          loading={updateMutation.isPending}
          disabled={lines.length === 0 || !tanggal}
        />
      </form>
    </div>
  );
}
