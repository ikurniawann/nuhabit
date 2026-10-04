"use client";

import { useRouter } from "next/navigation";
import { Loader2Icon, Package } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PurchasingFormFooter,
  PurchasingFormHeader,
} from "@/features/purchasing/components/shared/purchasing-page-header";
import { formatNumber, formatRupiah } from "@/lib/format";
import { summarizeDeliveryItems, validateDeliveryForm } from "@/lib/purchasing/receiving-ui-delivery";
import { GuidelinesBox, SummaryRow } from "../../grn/components/receiving-form-parts";
import { useCreateDelivery } from "../mutations";
import { useDeliveryPOOptions, usePOItemsForDelivery } from "../queries";
import { DeliveryInfoCard, useDeliveryDraft } from "./delivery-form-parts";
import { DeliveryPoItemsTable } from "./delivery-po-items-table";

const LIST_ROUTE = "/dashboard/purchasing/delivery";

const GUIDELINES = [
  "Pilih purchase order yang sudah disetujui, dikirim, atau diterima sebagian.",
  "Purchase order yang pengirimannya sudah selesai tetap bisa menerima pengiriman tambahan.",
  "Purchase order yang masih memiliki pengiriman berjalan disembunyikan dari daftar ini.",
  "Nomor surat jalan, tanggal kirim, dan estimasi tanggal tiba wajib diisi.",
  "Status awal adalah menunggu penerimaan.",
];

const RESHIP_GUIDELINES = [
  "Pengiriman ini untuk sisa qty PO yang belum diterima (lolos QC).",
  "Kolom Sisa = qty yang diharapkan datang pada pengiriman ulang ini.",
  "Setelah barang tiba, buat GRN baru dari surat jalan pengiriman ulang.",
  "Nomor surat jalan, tanggal kirim, dan estimasi tanggal tiba wajib diisi.",
];

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

export function CreateDeliveryPage() {
  const router = useRouter();
  const poOptionsQuery = useDeliveryPOOptions(false);
  const poList = poOptionsQuery.data ?? [];
  const draft = useDeliveryDraft(poList, poOptionsQuery.isSuccess);
  const { selectedPO, poId, fields } = draft;
  const createMutation = useCreateDelivery();

  // PO dikunci saat halaman dibuka dari detail PO supaya pengiriman tetap melekat pada PO asal.
  // Bila preset tidak memenuhi syarat, dropdown tetap terbuka.
  const poLocked = Boolean(draft.presetPoId) && poId === draft.presetPoId;

  const poItemsQuery = usePOItemsForDelivery(poId);
  const poItems = poItemsQuery.data ?? [];
  const summary = summarizeDeliveryItems(poItems);
  const { isReship } = summary;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const error = validateDeliveryForm(poId, fields);
    if (error) {
      toast.error(error);
      return;
    }
    try {
      const data = await createMutation.mutateAsync({ ...fields, po_id: poId, supplier_id: selectedPO?.supplier_id || "" });
      toast.success(`Pengiriman ${data.nomor_resi || ""} berhasil dibuat.`);
      router.push(data.id ? `${LIST_ROUTE}/${data.id}` : LIST_ROUTE);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Gagal membuat pengiriman."));
    }
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={LIST_ROUTE}
        title={isReship ? "Kirim Ulang — Sisa PO" : "Tambah Pengiriman"}
        description={
          isReship
            ? "Catat pengiriman ulang supplier untuk qty yang belum diterima"
            : "Catat pengiriman dari supplier berdasarkan purchase order"
        }
      />

      <form id="create-delivery-form" onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-8">
            <DeliveryInfoCard
              poList={poList}
              poId={poId}
              onPoChange={draft.setPoId}
              fetchingPOs={poOptionsQuery.isLoading}
              poLocked={poLocked}
              partyLabel="supplier"
              fields={fields}
              setField={draft.setField}
            />

            {poId && (
              <Card className="border-gray-200/70 shadow-xs">
                <CardHeader className="border-b border-gray-200/70 pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Package className="h-4 w-4" />
                    {isReship ? "Item yang dikirim ulang (sisa)" : "Item Purchase Order"}
                  </CardTitle>
                  {isReship && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Qty di kolom Sisa adalah yang belum diterima — ini target pengiriman ulang.
                    </p>
                  )}
                </CardHeader>
                <CardContent className="p-0">
                  {poItemsQuery.isLoading ? (
                    <div className="flex items-center justify-center py-10 text-sm text-gray-500">
                      <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                      Memuat item purchase order...
                    </div>
                  ) : poItemsQuery.isError ? (
                    <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-gray-500">
                      <span>{errorMessage(poItemsQuery.error, "Gagal memuat item purchase order.")}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="purchasing-secondary-button"
                        disabled={poItemsQuery.isFetching}
                        onClick={() => poItemsQuery.refetch()}
                      >
                        {poItemsQuery.isFetching && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
                        Coba lagi
                      </Button>
                    </div>
                  ) : poItems.length === 0 ? (
                    <div className="py-10 text-center text-sm text-gray-500">Tidak ada item untuk purchase order ini</div>
                  ) : (
                    <DeliveryPoItemsTable items={poItems} isReship={isReship} />
                  )}
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
                {selectedPO ? (
                  <dl className="space-y-3 text-sm">
                    <SummaryRow label="Purchase Order">{selectedPO.nomor_po}</SummaryRow>
                    <SummaryRow label="Supplier">{selectedPO.nama_supplier || "-"}</SummaryRow>
                    <SummaryRow label="Item">{poItemsQuery.isLoading ? "..." : poItems.length}</SummaryRow>
                    {isReship && (
                      <>
                        <SummaryRow label="Sudah diterima">{formatNumber(summary.totalReceived, 4)}</SummaryRow>
                        <div className="flex items-start justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                          <dt className="font-medium text-brand-text">Sisa dikirim ulang</dt>
                          <dd className="text-right font-semibold text-brand-text">
                            {formatNumber(summary.totalRemaining, 4)}
                            <span className="mt-0.5 block text-xs font-normal text-brand-text/80">
                              {summary.itemsWithRemaining} item
                            </span>
                          </dd>
                        </div>
                      </>
                    )}
                    {poItems.length > 0 && (
                      <SummaryRow label="Estimasi Total" strong className="border-t border-gray-200/70 pt-3">
                        {formatRupiah(summary.subtotal)}
                      </SummaryRow>
                    )}
                  </dl>
                ) : (
                  <p className="text-sm text-gray-500">Pilih purchase order untuk melihat pratinjau detail pengiriman.</p>
                )}
                <GuidelinesBox lines={isReship ? RESHIP_GUIDELINES : GUIDELINES} />
              </CardContent>
            </Card>
          </div>
        </div>

        <PurchasingFormFooter
          formId="create-delivery-form"
          onCancel={() => router.push(LIST_ROUTE)}
          submitLabel={isReship ? "Simpan Kirim Ulang" : "Simpan"}
          loading={createMutation.isPending}
          disabled={!poId || !fields.no_surat_jalan.trim() || !fields.tanggal_kirim || !fields.tanggal_estimasi_tiba}
        />
      </form>
    </div>
  );
}
