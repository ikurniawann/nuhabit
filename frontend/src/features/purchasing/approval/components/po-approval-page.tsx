"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import {
  NAV_FROM_APPROVAL_PO,
  persistNavFrom,
} from "@/lib/iam/nav-context";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { getApprovalModuleConfig } from "../approval-module";
import { CheckCircle, Loader2, ShoppingCart } from "lucide-react";
import { formatDate, formatRupiah } from "@/lib/format";
import { getPOStatusLabel } from "@/lib/purchasing/status-labels";
import { usePurchaseOrderList } from "../../po/queries";
import { useApprovePurchaseOrder } from "../../po/mutations";
import { useProductPurchaseOrderList } from "../../product-po/queries";
import { useApproveProductPurchaseOrder } from "../../product-po/mutations";
import { useGeneralPurchaseOrderList } from "../../general-po/queries";
import { useApproveGeneralPurchaseOrder } from "../../general-po/mutations";
import type { PurchaseOrder } from "@/types/purchasing";
import type { ProductPOListItem } from "../../product-po/types";
import type { GeneralPOListItem } from "../../general-po/types";

const DRAFT_STATUS_STYLE = "border-gray-200 bg-gray-50 text-gray-700";

type POApprovalPageProps = {
  moduleType?: PurchasingModuleType;
};

type ApprovalPO = PurchaseOrder | ProductPOListItem | GeneralPOListItem;

export function POApprovalPage({ moduleType = "raw_material" }: POApprovalPageProps) {
  const router = useRouter();
  const config = getApprovalModuleConfig(moduleType);
  const isProduct = config.isProduct;
  const isGeneral = config.isGeneral;
  const usesVendor = isProduct || isGeneral;
  const [confirmingPO, setConfirmingPO] = useState<ApprovalPO | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Hanya query milik modul aktif yang berjalan.
  const draftParams = { status: "draft", page: 1, limit: 50 } as const;
  const rmListQuery = usePurchaseOrderList(draftParams, !isProduct && !isGeneral);
  const productListQuery = useProductPurchaseOrderList(draftParams, isProduct);
  const generalListQuery = useGeneralPurchaseOrderList(draftParams, isGeneral);
  const listQuery = isGeneral ? generalListQuery : isProduct ? productListQuery : rmListQuery;
  const pos = (listQuery.data?.data ?? []) as ApprovalPO[];
  const loading = listQuery.isLoading;

  const rmApproveMutation = useApprovePurchaseOrder();
  const productApproveMutation = useApproveProductPurchaseOrder();
  const generalApproveMutation = useApproveGeneralPurchaseOrder();
  const approveMutation = isGeneral
    ? generalApproveMutation
    : isProduct
      ? productApproveMutation
      : rmApproveMutation;
  const isProcessing = Boolean(processingId);

  function poDetailHref(id: string) {
    persistNavFrom(NAV_FROM_APPROVAL_PO);
    return config.poDetailFromApproval(id);
  }

  async function approvePO() {
    if (!confirmingPO) return;
    setProcessingId(confirmingPO.id);
    try {
      await approveMutation.mutateAsync(confirmingPO.id);
      toast.success("PO berhasil disetujui");
      setConfirmingPO(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyetujui PO");
    } finally {
      setProcessingId(null);
    }
  }

  function closeDialog() {
    if (isProcessing) return;
    setConfirmingPO(null);
  }

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Persetujuan PO"
        description={
          usesVendor
            ? "Tinjau vendor, harga, pajak, dan total final sebelum PO dikirim."
            : "Tinjau supplier, harga, pajak, dan total final sebelum PO dikirim."
        }
        actions={
          <Link href={config.purchasingPoRoute}>
            <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
              Lihat Semua PO
            </Button>
          </Link>
        }
      />

      <PurchasingListSection
        icon={ShoppingCart}
        title="Menunggu Persetujuan"
        description={
          usesVendor
            ? "PO draf yang menunggu persetujuan sebelum dikirim ke vendor."
            : "PO draf yang menunggu persetujuan sebelum dikirim ke supplier."
        }
      >
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-pink-600" />
            Memuat persetujuan...
          </div>
        ) : listQuery.isError ? (
          <div className="py-12 text-center text-sm text-red-600">
            {listQuery.error instanceof Error ? listQuery.error.message : "Gagal memuat persetujuan PO"}
          </div>
        ) : pos.length === 0 ? (
          <div className="py-14 text-center">
            <CheckCircle className="mx-auto mb-3 h-12 w-12 text-emerald-300" />
            <p className="text-gray-500">Tidak ada PO yang menunggu persetujuan</p>
            <p className="mt-1 text-sm text-gray-400">Semua sudah ditindaklanjuti.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Nomor</th>
                    <th className="px-4 py-3 text-left font-semibold">Tanggal</th>
                    <th className="px-4 py-3 text-left font-semibold">{config.partyLabel}</th>
                    <th className="px-4 py-3 text-left font-semibold">PR</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                    <th className="px-4 py-3 text-center font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pos.map((po) => {
                    const rowProcessing = processingId === po.id;

                    return (
                      <tr
                        key={po.id}
                        className="cursor-pointer hover:bg-gray-50/80"
                        onClick={() => router.push(poDetailHref(po.id))}
                      >
                        <td
                          className="px-4 py-3"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Link
                            href={poDetailHref(po.id)}
                            className="font-medium text-pink-700 hover:underline"
                          >
                            {po.nomor_po}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{formatDate(po.tanggal_po)}</td>
                        <td className="px-4 py-3 text-gray-600">{config.poPartyName(po)}</td>
                        <td className="px-4 py-3 text-gray-600">{po.pr_number || "-"}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">
                          {formatRupiah(po.grand_total || ("total" in po ? po.total : 0) || po.subtotal)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant="outline" className={DRAFT_STATUS_STYLE}>
                            {getPOStatusLabel("draft").label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right" onClick={(event) => event.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Setujui"
                              className="cursor-pointer"
                              onClick={() => setConfirmingPO(po)}
                              disabled={rowProcessing}
                            >
                              {rowProcessing ? (
                                <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                              ) : (
                                <CheckCircle className="h-4 w-4 text-emerald-600" />
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-gray-200/70 px-4 py-3 text-sm text-gray-500">
              Menampilkan {pos.length} PO yang menunggu persetujuan
            </div>
          </>
        )}
      </PurchasingListSection>

      <Dialog open={confirmingPO !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogPanel size="xs">
          <DialogPanelHeader>
            <DialogPanelTitle>Setujui PO?</DialogPanelTitle>
            <DialogPanelDescription>
              {confirmingPO
                ? usesVendor
                  ? `${confirmingPO.nomor_po} akan disetujui dan dapat dikirim ke vendor.`
                  : `${confirmingPO.nomor_po} akan disetujui dan dapat dikirim ke supplier.`
                : usesVendor
                  ? "PO ini akan disetujui dan dapat dikirim ke vendor."
                  : "PO ini akan disetujui dan dapat dikirim ke supplier."}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody />
          <DialogFooter className="px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="purchasing-secondary-button"
              onClick={closeDialog}
              disabled={isProcessing}
            >
              Batal
            </Button>
            <Button
              type="button"
              className="purchasing-main-button"
              onClick={approvePO}
              disabled={isProcessing}
            >
              {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isProcessing ? "Menyetujui..." : "Setujui"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
