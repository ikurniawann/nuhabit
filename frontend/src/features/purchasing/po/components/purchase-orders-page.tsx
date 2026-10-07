"use client";

import { useEffect, useState } from "react";
import { CheckCircle, FileText, Filter, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { PurchasingTablePagination } from "@/features/purchasing/components/shared/purchasing-table-pagination";
import type { SendVia } from "@/lib/purchasing/po-ui-status";
import type { POStatus, PurchaseOrderWithStats } from "@/types/purchasing";
import { useApprovePurchaseOrder, useCancelPurchaseOrder, useSendPurchaseOrder } from "../mutations";
import { usePurchaseOrderList } from "../queries";
import { ConfirmPODialog, ReasonPODialog, SendPODialog } from "./po-dialogs";
import { POListRow } from "./po-list-row";

const PAGE_SIZE = 20;

const STATUS_OPTIONS: { value: POStatus | "all"; label: string }[] = [
  { value: "all", label: "Semua Status" },
  { value: "draft", label: "Draf" },
  { value: "pending_approval", label: "Menunggu Persetujuan" },
  { value: "approved", label: "Disetujui" },
  { value: "sent", label: "Terkirim" },
  { value: "partial", label: "Diterima Sebagian" },
  { value: "partially_received", label: "Diterima Sebagian" },
  { value: "received", label: "Selesai" },
  { value: "rejected", label: "Ditolak" },
  { value: "cancelled", label: "Dibatalkan" },
];

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

type RowDialog = { kind: "send" | "cancel"; po: PurchaseOrderWithStats } | null;

export function PurchaseOrdersPage() {
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<POStatus | "all">("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false);
  const [isBulkApproving, setIsBulkApproving] = useState(false);
  const [rowDialog, setRowDialog] = useState<RowDialog>(null);
  const [processingPoId, setProcessingPoId] = useState<string | null>(null);

  const listQuery = usePurchaseOrderList({
    search: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    page,
    limit: PAGE_SIZE,
  });
  const pos = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination?.total ?? listQuery.data?.total ?? 0;
  const totalPages =
    listQuery.data?.pagination?.total_pages ?? listQuery.data?.total_pages ?? Math.ceil(total / PAGE_SIZE);

  const approveMutation = useApprovePurchaseOrder();
  const sendMutation = useSendPurchaseOrder();
  const cancelMutation = useCancelPurchaseOrder();

  // Debounce pencarian; halaman kembali ke 1 setiap kata kunci berubah.
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const toggleSelectAll = (checked: boolean) => setSelectedIds(checked ? new Set(pos.map((po) => po.id)) : new Set());

  const toggleSelectItem = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleBulkApprove = async () => {
    setIsBulkApproving(true);
    const failedIds: string[] = [];
    for (const id of selectedIds) {
      try {
        await approveMutation.mutateAsync(id);
      } catch {
        failedIds.push(id);
      }
    }
    const successCount = selectedIds.size - failedIds.length;
    if (successCount > 0) toast.success(`${successCount} purchase order berhasil disetujui`);
    if (failedIds.length > 0) {
      toast.error(
        `${failedIds.length} purchase order gagal disetujui: ${failedIds.slice(0, 3).join(", ")}${failedIds.length > 3 ? "..." : ""}`
      );
    }
    setSelectedIds(new Set());
    setBulkApproveOpen(false);
    setIsBulkApproving(false);
  };

  const runRowAction = async (poId: string, action: () => Promise<unknown>, success: string, fallback: string) => {
    setProcessingPoId(poId);
    try {
      await action();
      toast.success(success);
      setRowDialog(null);
    } catch (error) {
      toast.error(errorMessage(error, fallback));
    } finally {
      setProcessingPoId(null);
    }
  };

  const handleSend = (po: PurchaseOrderWithStats, sentVia: SendVia) =>
    runRowAction(
      po.id,
      () => sendMutation.mutateAsync({ id: po.id, sentVia }),
      `Purchase order berhasil dikirim via ${sentVia}`,
      "Gagal mengirim purchase order"
    );

  const handleResetFilters = () => {
    setSearchQuery("");
    setSearch("");
    setStatusFilter("all");
    setPage(1);
  };

  const isFilterActive = statusFilter !== "all";
  const dialogPo = rowDialog?.po;

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Purchase Order"
        description={`Kelola purchase order dari purchase request yang disetujui hingga penerimaan barang, total ${total}`}
      />

      <PurchasingListSection
        icon={FileText}
        title="Daftar Purchase Order"
        description="Pantau purchase order, supplier, status persetujuan, dan progres penerimaan."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Cari nomor purchase order atau supplier..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 bg-white pl-10 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
              />
            </label>

            <Button
              type="button"
              variant="outline"
              onClick={() => setFilterOpen((open) => !open)}
              className={
                isFilterActive
                  ? "h-10 gap-2 rounded-lg border-pink-600 bg-pink-600 px-3 text-sm font-semibold !text-white shadow-sm hover:!border-pink-700 hover:!bg-pink-700 hover:!text-white [&_*]:!text-white [&_svg]:!text-white"
                  : "h-10 gap-2 rounded-lg border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:!border-pink-200 hover:!bg-pink-50 hover:!text-pink-700"
              }
            >
              <Filter className={isFilterActive ? "h-4 w-4 text-white" : "h-4 w-4"} />
              Filter
              {isFilterActive && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 text-xs text-white">
                  1
                </span>
              )}
            </Button>

            {(search || isFilterActive || page > 1) && (
              <Button variant="outline" onClick={handleResetFilters} className="h-10 flex-shrink-0 rounded-lg">
                Atur Ulang
              </Button>
            )}
          </div>
        }
      >
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-3">
            <span className="text-sm font-medium text-blue-800">{selectedIds.size} purchase order dipilih</span>
            <Button size="sm" variant="outline" onClick={() => setBulkApproveOpen(true)} disabled={isBulkApproving}>
              <CheckCircle className="mr-1 h-4 w-4" />
              Setujui Terpilih
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
              Bersihkan
            </Button>
          </div>
        )}

        {filterOpen && (
          <div className="border-b border-gray-100 bg-gray-50/70 px-5 py-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <Filter className="h-3.5 w-3.5 text-pink-500" />
                  Status
                </div>
                <Combobox
                  options={STATUS_OPTIONS}
                  value={statusFilter}
                  onChange={(value) => {
                    setStatusFilter(value as POStatus | "all");
                    setPage(1);
                  }}
                  placeholder="Filter status..."
                  searchPlaceholder="Cari status..."
                  emptyMessage="Status tidak ditemukan"
                  className="!w-full h-9 text-sm"
                />
              </div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="w-[50px] px-4 py-3 text-left font-semibold">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === pos.length && pos.length > 0}
                    onChange={(e) => toggleSelectAll(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="px-4 py-3 text-left font-semibold">Purchase Order</th>
                <th className="px-4 py-3 text-left font-semibold">Purchase Request</th>
                <th className="px-4 py-3 text-left font-semibold">Supplier</th>
                <th className="px-4 py-3 text-left font-semibold">Tanggal</th>
                <th className="px-4 py-3 text-right font-semibold">Total</th>
                <th className="px-4 py-3 text-center font-semibold">Status</th>
                <th className="px-4 py-3 text-left font-semibold">Progres</th>
                <th className="px-4 py-3 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {listQuery.isLoading || listQuery.isError || pos.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-sm text-gray-500">
                    {listQuery.isLoading
                      ? "Memuat purchase order..."
                      : listQuery.isError
                        ? "Gagal memuat purchase order"
                        : "Purchase order tidak ditemukan"}
                  </td>
                </tr>
              ) : (
                pos.map((po) => (
                  <POListRow
                    key={po.id}
                    po={po}
                    selected={selectedIds.has(po.id)}
                    processing={processingPoId === po.id}
                    onToggle={() => toggleSelectItem(po.id)}
                    onApprove={() =>
                      runRowAction(
                        po.id,
                        () => approveMutation.mutateAsync(po.id),
                        "Purchase order berhasil disetujui",
                        "Gagal menyetujui purchase order"
                      )
                    }
                    onSend={() => setRowDialog({ kind: "send", po })}
                    onCancel={() => setRowDialog({ kind: "cancel", po })}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        <PurchasingTablePagination
          page={page}
          totalPages={Math.max(1, totalPages)}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      </PurchasingListSection>

      <SendPODialog
        open={rowDialog?.kind === "send"}
        onOpenChange={(open) => !open && setRowDialog(null)}
        title="Kirim Purchase Order ke Supplier"
        poNumber={dialogPo?.nomor_po}
        pending={sendMutation.isPending}
        onConfirm={(sentVia) => dialogPo && handleSend(dialogPo, sentVia)}
      />

      <ReasonPODialog
        open={rowDialog?.kind === "cancel"}
        onOpenChange={(open) => !open && setRowDialog(null)}
        title="Batalkan Purchase Order"
        description={`Apakah Anda yakin ingin membatalkan purchase order ${dialogPo?.nomor_po ?? ""}? Masukkan alasan pembatalan.`}
        label="Alasan Pembatalan"
        placeholder="Contoh: Kebutuhan berubah"
        confirmLabel="Batalkan Purchase Order"
        destructive
        pending={cancelMutation.isPending}
        onConfirm={(reason) =>
          dialogPo &&
          runRowAction(
            dialogPo.id,
            () => cancelMutation.mutateAsync({ id: dialogPo.id, reason }),
            "Purchase order berhasil dibatalkan",
            "Gagal membatalkan purchase order"
          )
        }
      />

      <ConfirmPODialog
        open={bulkApproveOpen}
        onOpenChange={setBulkApproveOpen}
        title="Setujui Beberapa PO"
        description={`Anda akan menyetujui ${selectedIds.size} purchase order yang dipilih. Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel={`Setujui ${selectedIds.size} PO`}
        pending={isBulkApproving}
        onConfirm={handleBulkApprove}
      />
    </div>
  );
}
