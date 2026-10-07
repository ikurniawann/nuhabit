"use client";

import { useRouter } from "next/navigation";
import { Loader2, Package } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PurchasingFormFooter,
  PurchasingFormHeader,
} from "@/features/purchasing/components/shared/purchasing-page-header";
import { formatNumber, formatRupiah } from "@/lib/format";
import { PRODUCT_ROUTES } from "@/lib/purchasing/item-routes";
import { summarizeDeliveryItems, validateDeliveryForm } from "@/lib/purchasing/receiving-ui-delivery";
import { DeliveryInfoCard, useDeliveryDraft } from "../../delivery/components/delivery-form-parts";
import { GuidelinesBox, SummaryRow } from "../../grn/components/receiving-form-parts";
import { useCreateProductDelivery } from "../mutations";
import { useProductDeliveryPOOptions, useProductPOItemsForDelivery } from "../queries";

const DELIVERY_LIST = PRODUCT_ROUTES.purchasingDelivery;

const GUIDELINES = [
  "Pilih purchase order yang sudah disetujui, dikirim, atau diterima sebagian.",
  "Purchase order yang pengirimannya sudah selesai tetap bisa menerima pengiriman tambahan.",
  "Purchase order yang masih memiliki pengiriman berjalan disembunyikan dari daftar ini.",
  "Nomor surat jalan, tanggal kirim, dan estimasi tanggal tiba wajib diisi.",
  "Status awal adalah menunggu penerimaan.",
];

export function NewProductDeliveryPage() {
  const router = useRouter();
  const poOptionsQuery = useProductDeliveryPOOptions(false);
  const poList = poOptionsQuery.data ?? [];
  const draft = useDeliveryDraft(poList, poOptionsQuery.isSuccess);
  const { selectedPO, poId, fields } = draft;
  const createMutation = useCreateProductDelivery();

  const poItemsQuery = useProductPOItemsForDelivery(poId);
  const poItems = poItemsQuery.data ?? [];
  const { subtotal } = summarizeDeliveryItems(poItems);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const error = validateDeliveryForm(poId, fields);
    if (error) {
      toast.error(error);
      return;
    }
    try {
      const data = await createMutation.mutateAsync({ ...fields, po_id: poId, vendor_id: selectedPO?.vendor_id || "" });
      toast.success(`Pengiriman ${data.nomor_resi || ""} berhasil dibuat.`);
      router.push(data.id ? `${DELIVERY_LIST}/${data.id}` : DELIVERY_LIST);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat pengiriman.");
    }
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={DELIVERY_LIST}
        title="Tambah Pengiriman"
        description="Catat pengiriman dari vendor berdasarkan purchase order"
      />

      <form id="new-product-delivery-form" onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-8">
            <DeliveryInfoCard
              poList={poList}
              poId={poId}
              onPoChange={draft.setPoId}
              fetchingPOs={poOptionsQuery.isLoading}
              partyLabel="vendor"
              fields={fields}
              setField={draft.setField}
            />

            {poId && (
              <Card className="border-gray-200/70 shadow-xs">
                <CardHeader className="border-b border-gray-200/70 pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Package className="h-4 w-4" />
                    Item Purchase Order
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {poItemsQuery.isLoading ? (
                    <div className="flex items-center justify-center py-10 text-sm text-gray-500">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Memuat item purchase order...
                    </div>
                  ) : poItems.length === 0 ? (
                    <div className="py-10 text-center text-sm text-gray-500">Tidak ada item untuk purchase order ini</div>
                  ) : (
                    <div className="overflow-x-auto px-4">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200/70 text-xs uppercase tracking-wide text-gray-500">
                            <th className="py-3 pr-4 text-left font-semibold">Produk</th>
                            <th className="px-4 py-3 text-right font-semibold">Qty</th>
                            <th className="px-4 py-3 text-left font-semibold">Satuan</th>
                            <th className="px-4 py-3 text-right font-semibold">Harga Satuan</th>
                            <th className="py-3 pl-4 text-right font-semibold">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200/70">
                          {poItems.map((item) => (
                            <tr key={item.id} className="hover:bg-gray-50/80">
                              <td className="py-3 pr-4">
                                <div className="font-medium text-gray-900">{item.product?.nama || "-"}</div>
                                <div className="text-xs text-gray-500">{item.product?.kode || ""}</div>
                              </td>
                              <td className="px-4 py-3 text-right text-gray-700">{formatNumber(item.qty_ordered, 4)}</td>
                              <td className="px-4 py-3 text-gray-700">
                                {item.satuan?.nama || item.satuan?.nama_satuan || "-"}
                              </td>
                              <td className="px-4 py-3 text-right text-gray-700">{formatRupiah(item.harga_satuan)}</td>
                              <td className="py-3 pl-4 text-right font-medium text-gray-900">{formatRupiah(item.subtotal)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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
                    <SummaryRow label="Vendor">{selectedPO.nama_supplier || "-"}</SummaryRow>
                    <SummaryRow label="Item">{poItemsQuery.isLoading ? "..." : poItems.length}</SummaryRow>
                    {poItems.length > 0 && (
                      <SummaryRow label="Estimasi Total" strong className="border-t border-gray-200/70 pt-3">
                        {formatRupiah(subtotal)}
                      </SummaryRow>
                    )}
                  </dl>
                ) : (
                  <p className="text-sm text-gray-500">Pilih purchase order untuk melihat pratinjau detail pengiriman.</p>
                )}
                <GuidelinesBox lines={GUIDELINES} />
              </CardContent>
            </Card>
          </div>
        </div>

        <PurchasingFormFooter
          formId="new-product-delivery-form"
          onCancel={() => router.push(DELIVERY_LIST)}
          loading={createMutation.isPending}
          disabled={!poId || !fields.no_surat_jalan.trim() || !fields.tanggal_kirim || !fields.tanggal_estimasi_tiba}
        />
      </form>
    </div>
  );
}
