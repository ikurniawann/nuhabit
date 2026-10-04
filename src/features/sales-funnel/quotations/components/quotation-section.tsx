"use client";

import { useState } from "react";
import {
  Check,
  FileDown,
  FileText,
  Loader2,
  PackageMinus,
  Plus,
  Send,
  Trash2,
  X, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDate, formatRupiah } from "@/lib/format";
import {
  useDeleteQuotation,
  useQuotations,
  useRealizeQuotation,
  useSendQuotationWa,
  useReviseQuotation,
  useUpdateQuotation,
} from "../queries";
import {
  QUOTATION_STATUS_BADGES,
  APPROVAL_STATUS_BADGES,
  APPROVAL_STATUS_LABELS,
  QUOTATION_STATUS_LABELS,
  type Quotation,
  type RealizeConflictError,
} from "../types";
import { QuotationBuilderDialog } from "./quotation-builder-dialog";
import { RealizeDialog } from "./realize-dialog";

interface QuotationSectionProps {
  dealId: string;
  enabled: boolean;
}

export function QuotationSection({ dealId, enabled }: QuotationSectionProps) {
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<Quotation | null>(null);
  const [deleting, setDeleting] = useState<Quotation | null>(null);
  const [conflict, setConflict] = useState<
    (RealizeConflictError & { quotationId: string }) | null
  >(null);

  const quotationsQuery = useQuotations(dealId, enabled);
  const deleteMutation = useDeleteQuotation();
  const sendWaMutation = useSendQuotationWa();
  const reviseMutation = useReviseQuotation(dealId);
  const statusMutation = useUpdateQuotation();
  const realizeMutation = useRealizeQuotation((error, quotationId) => {
    setConflict(Object.assign(error, { quotationId }));
  });
  const quotations = quotationsQuery.data ?? [];

  const startRealize = (quotation: Quotation) => {
    realizeMutation.mutate(
      { id: quotation.id, force: false },
      { onSuccess: () => setConflict(null) }
    );
  };

  return (
    <div className="space-y-2.5 border-b border-gray-100 px-6 py-4">
      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <FileText className="h-4 w-4 text-pink-500" /> Quotation
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setEditing(null);
            setBuilderOpen(true);
          }}
          className="h-8 gap-1 rounded-lg bg-pink-600 text-white hover:bg-pink-700"
        >
          <Plus className="h-3.5 w-3.5" /> Buat Quotation
        </Button>
      </div>

      {quotationsQuery.isLoading ? (
        <div className="py-3 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-pink-600" />
        </div>
      ) : quotations.length === 0 ? (
        <p className="py-2 text-xs text-gray-400">
          Belum ada penawaran — susun item bebas + produk katalog per pax.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {quotations.map((quotation) => (
            <li
              key={quotation.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-gray-200/80 bg-white px-3 py-2.5"
            >
              <button
                type="button"
                onClick={() => {
                  setEditing(quotation);
                  setBuilderOpen(true);
                }}
                className="min-w-0 flex-1 text-left"
              >
                <p className="text-sm font-medium text-gray-900 hover:text-pink-600">
                  {quotation.quote_number}
                </p>
                <p className="text-xs text-gray-500">
                  {quotation.items.length} item ·{" "}
                  {quotation.use_ppn
                    ? `PPN ${Number(quotation.ppn_persen)}%`
                    : "tanpa PPN"}
                  {quotation.valid_until
                    ? ` · s/d ${formatDate(quotation.valid_until)}`
                    : ""}
                </p>
              </button>
              <div className="shrink-0 text-right">
                <div className="flex items-center justify-end gap-1">
                  {quotation.bom_status ? (
                    <Badge
                      className={
                        quotation.bom_status === "terpotong"
                          ? "border-0 bg-emerald-100 font-normal text-emerald-700"
                          : "border-0 bg-amber-100 font-semibold text-amber-700"
                      }
                    >
                      {quotation.bom_status === "terpotong"
                        ? "BOM terpotong"
                        : "BOM tidak terpotong"}
                    </Badge>
                  ) : null}
                  <Badge className={QUOTATION_STATUS_BADGES[quotation.status]}>
                    {QUOTATION_STATUS_LABELS[quotation.status]}
                  </Badge>
                  {quotation.version && quotation.version > 1 ? (
                    <Badge className="border-0 bg-violet-100 font-normal text-violet-700">v{quotation.version}</Badge>
                  ) : null}
                  {quotation.approval_status && quotation.approval_status !== "none" ? (
                    <Badge className={APPROVAL_STATUS_BADGES[quotation.approval_status]} title="EPIC-050: diskon di atas ambang wajib disetujui">
                      {APPROVAL_STATUS_LABELS[quotation.approval_status]}
                      {Number(quotation.discount_percent) ? ` (${Number(quotation.discount_percent)}%)` : ""}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-sm font-semibold text-gray-900">
                  {formatRupiah(quotation.total)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-center gap-1.5">
                <div className="flex items-center gap-1.5">
                  <a
                    href={`/api/sales-funnel/quotations/${quotation.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Unduh PDF"
                    className="text-gray-400 hover:text-pink-600"
                  >
                    <FileDown className="h-4 w-4" />
                  </a>
                  <button
                    type="button"
                    onClick={() => sendWaMutation.mutate(quotation.id)}
                    disabled={
                      sendWaMutation.isPending ||
                      quotation.approval_status === "pending" ||
                      quotation.approval_status === "rejected"
                    }
                    title={
                      quotation.approval_status === "pending"
                        ? "Menunggu approval diskon"
                        : quotation.approval_status === "rejected"
                          ? "Diskon ditolak — ubah diskon lalu ajukan lagi"
                          : "Kirim summary ke WA PIC"
                    }
                    className="text-gray-400 hover:text-emerald-600 disabled:opacity-40"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                  {quotation.status !== "superseded" ? (
                    <button
                      type="button"
                      onClick={() => reviseMutation.mutate(quotation.id)}
                      disabled={reviseMutation.isPending}
                      title="Buat revisi (versi baru; versi ini ditandai digantikan)"
                      className="text-gray-400 hover:text-violet-600 disabled:opacity-40"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  ) : null}
                  {!quotation.stock_deducted_at ? (
                    <button
                      type="button"
                      onClick={() => setDeleting(quotation)}
                      title="Hapus quotation"
                      className="text-gray-300 hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
                {quotation.status === "diterima" && !quotation.stock_deducted_at ? (
                  <button
                    type="button"
                    onClick={() => startRealize(quotation)}
                    disabled={realizeMutation.isPending}
                    title="Realisasi — potong stok bahan baku gudang venue"
                    className="inline-flex items-center gap-1 rounded-lg bg-pink-600 px-2 py-1 text-xs font-semibold text-white hover:bg-pink-700 disabled:opacity-50"
                  >
                    <PackageMinus className="h-3.5 w-3.5" />
                    Realisasi
                  </button>
                ) : null}
                {quotation.status === "terkirim" ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        statusMutation.mutate({
                          id: quotation.id,
                          values: { status: "diterima" },
                        })
                      }
                      disabled={statusMutation.isPending}
                      title="Tandai diterima"
                      className="rounded bg-emerald-50 p-1 text-emerald-600 hover:bg-emerald-100"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        statusMutation.mutate({
                          id: quotation.id,
                          values: { status: "ditolak" },
                        })
                      }
                      disabled={statusMutation.isPending}
                      title="Tandai ditolak"
                      className="rounded bg-red-50 p-1 text-red-500 hover:bg-red-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <QuotationBuilderDialog
        open={builderOpen}
        onOpenChange={(open) => {
          setBuilderOpen(open);
          if (!open) setEditing(null);
        }}
        dealId={dealId}
        quotation={editing}
      />
      <RealizeDialog
        conflict={conflict}
        onClose={() => setConflict(null)}
        onForce={(quotationId) =>
          realizeMutation.mutate(
            { id: quotationId, force: true },
            { onSuccess: () => setConflict(null) }
          )
        }
        isPending={realizeMutation.isPending}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus quotation?"
        description={`Quotation ${deleting?.quote_number ?? ""} akan dihapus.`}
        confirmLabel="Hapus"
        variant="danger"
        onConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
