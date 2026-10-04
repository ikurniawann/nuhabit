"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { persistNavFrom, NAV_FROM_APPROVAL_PR } from "@/lib/iam/nav-context";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { getApprovalModuleConfig } from "../approval-module";
import { CheckCircle, FileText, Loader2, XCircle } from "lucide-react";
import { formatDate, formatRupiah } from "@/lib/format";
import { getPriorityBadge, getPRStatusLabel } from "@/lib/purchasing/status-labels";
import { usePendingPRApprovals } from "../queries";
import { useApprovePRApproval, useRejectPRApproval } from "../mutations";
import type { ApprovalPR } from "../types";

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

type ProcessingState = {
  id: string;
  action: "approve" | "reject";
};

type PRApprovalPageProps = {
  moduleType?: PurchasingModuleType;
};

export function PRApprovalPage({ moduleType = "raw_material" }: PRApprovalPageProps) {
  const router = useRouter();
  const config = getApprovalModuleConfig(moduleType);
  const [confirmingPR, setConfirmingPR] = useState<ApprovalPR | null>(null);
  const [rejectingPR, setRejectingPR] = useState<ApprovalPR | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [processing, setProcessing] = useState<ProcessingState | null>(null);

  const listQuery = usePendingPRApprovals(moduleType);
  const prs = listQuery.data ?? [];
  const loading = listQuery.isLoading;

  const approveMutation = useApprovePRApproval(moduleType);
  const rejectMutation = useRejectPRApproval(moduleType);
  const isProcessing = Boolean(processing);

  async function approvePR() {
    if (!confirmingPR) return;
    setProcessing({ id: confirmingPR.id, action: "approve" });
    try {
      await approveMutation.mutateAsync(confirmingPR.id);
      toast.success("Permintaan pembelian berhasil disetujui");
      setConfirmingPR(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyetujui permintaan pembelian");
    } finally {
      setProcessing(null);
    }
  }

  async function rejectPR() {
    if (!rejectingPR) return;
    if (!rejectionReason.trim()) {
      toast.error("Alasan penolakan wajib diisi");
      return;
    }

    setProcessing({ id: rejectingPR.id, action: "reject" });
    try {
      await rejectMutation.mutateAsync({ id: rejectingPR.id, reason: rejectionReason.trim() });
      toast.success("Permintaan pembelian berhasil ditolak");
      setRejectingPR(null);
      setRejectionReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menolak permintaan pembelian");
    } finally {
      setProcessing(null);
    }
  }

  function closeApproveDialog() {
    if (isProcessing) return;
    setConfirmingPR(null);
  }

  function closeRejectDialog() {
    if (isProcessing) return;
    setRejectingPR(null);
    setRejectionReason("");
  }

  function prDetailHref(id: string) {
    persistNavFrom(NAV_FROM_APPROVAL_PR);
    return config.prDetailFromApproval(id);
  }

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Persetujuan PR"
        description="Tinjau dan setujui kebutuhan barang sebelum proses pembelian berjalan."
        actions={
          <Link href={config.purchasingPrRoute}>
            <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
              Lihat Semua PR
            </Button>
          </Link>
        }
      />

      <PurchasingListSection
        icon={FileText}
        title="Menunggu Persetujuan"
        description="Permintaan pembelian yang menunggu persetujuan Anda pada tahap alur kerja saat ini."
      >
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-pink-600" />
            Memuat persetujuan...
          </div>
        ) : listQuery.isError ? (
          <div className="py-12 text-center text-sm text-red-600">
            {listQuery.error instanceof Error
              ? listQuery.error.message
              : "Gagal memuat persetujuan permintaan pembelian"}
          </div>
        ) : prs.length === 0 ? (
          <div className="py-14 text-center">
            <CheckCircle className="mx-auto mb-3 h-12 w-12 text-emerald-300" />
            <p className="text-gray-500">Tidak ada permintaan pembelian yang menunggu persetujuan</p>
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
                    <th className="px-4 py-3 text-left font-semibold">Departemen</th>
                    <th className="px-4 py-3 text-left font-semibold">Pemohon</th>
                    <th className="px-4 py-3 text-right font-semibold">Estimasi Total</th>
                    <th className="px-4 py-3 text-center font-semibold">Prioritas</th>
                    <th className="px-4 py-3 text-center font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {prs.map((pr) => {
                    const priorityBadge = getPriorityBadge(pr.priority);
                    const statusBadge = getPRStatusLabel(pr.status);
                    const statusLabel = statusBadge.label;
                    const statusStyle =
                      PR_STATUS_STYLES[pr.status] ?? "border-gray-200 bg-gray-50 text-gray-700";
                    const priorityStyle =
                      PRIORITY_STYLES[pr.priority] ?? "border-gray-200 bg-gray-50 text-gray-700";
                    const rowProcessing = processing?.id === pr.id ? processing.action : null;

                    return (
                      <tr
                        key={pr.id}
                        className="cursor-pointer hover:bg-gray-50/80"
                        onClick={() => router.push(prDetailHref(pr.id))}
                      >
                        <td
                          className="px-4 py-3"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Link
                            href={prDetailHref(pr.id)}
                            className="font-medium text-pink-700 hover:underline"
                          >
                            {pr.pr_number}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{formatDate(pr.created_at)}</td>
                        <td className="px-4 py-3 text-gray-600">{pr.department_name || "-"}</td>
                        <td className="px-4 py-3 text-gray-600">{pr.requester_name || "-"}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">
                          {formatRupiah(pr.total_amount)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant="outline" className={priorityStyle}>
                            {priorityBadge.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant="outline" className={statusStyle}>
                            {statusLabel}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right" onClick={(event) => event.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Setujui"
                              className="cursor-pointer"
                              onClick={() => setConfirmingPR(pr)}
                              disabled={Boolean(rowProcessing)}
                            >
                              {rowProcessing === "approve" ? (
                                <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                              ) : (
                                <CheckCircle className="h-4 w-4 text-emerald-600" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Tolak"
                              className="cursor-pointer"
                              onClick={() => {
                                setRejectingPR(pr);
                                setRejectionReason("");
                              }}
                              disabled={Boolean(rowProcessing)}
                            >
                              {rowProcessing === "reject" ? (
                                <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-600" />
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
              Menampilkan {prs.length} permintaan pembelian yang menunggu persetujuan
            </div>
          </>
        )}
      </PurchasingListSection>

      <Dialog open={confirmingPR !== null} onOpenChange={(open) => !open && closeApproveDialog()}>
        <DialogPanel size="xs">
          <DialogPanelHeader>
            <DialogPanelTitle>Setujui Permintaan Pembelian?</DialogPanelTitle>
            <DialogPanelDescription>
              {confirmingPR
                ? `${confirmingPR.pr_number} akan disetujui sebagai kebutuhan yang sah dan dapat dilanjutkan ke pembuatan PO.`
                : "Permintaan ini akan disetujui sebagai kebutuhan yang sah."}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody />
          <DialogFooter className="px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="purchasing-secondary-button"
              onClick={closeApproveDialog}
              disabled={isProcessing}
            >
              Batal
            </Button>
            <Button
              type="button"
              className="purchasing-main-button"
              onClick={approvePR}
              disabled={isProcessing}
            >
              {processing?.action === "approve" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {processing?.action === "approve" ? "Menyetujui..." : "Setujui"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>

      <Dialog open={rejectingPR !== null} onOpenChange={(open) => !open && closeRejectDialog()}>
        <DialogPanel size="sm">
          <DialogPanelHeader>
            <DialogPanelTitle>Tolak Permintaan Pembelian</DialogPanelTitle>
            <DialogPanelDescription>
              {rejectingPR
                ? `Berikan alasan penolakan untuk ${rejectingPR.pr_number}. Pemohon dapat membuat revisi bila diperlukan.`
                : "Berikan alasan penolakan untuk permintaan ini."}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody>
            <div className="space-y-1.5">
              <Label htmlFor="pr-list-rejection-reason" className="text-xs">
                Alasan Penolakan <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="pr-list-rejection-reason"
                value={rejectionReason}
                onChange={(event) => setRejectionReason(event.target.value)}
                placeholder="Jelaskan alasan permintaan ini ditolak..."
                rows={4}
                className="resize-none text-sm"
                disabled={isProcessing}
              />
            </div>
          </DialogPanelBody>
          <DialogFooter className="px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="purchasing-secondary-button"
              onClick={closeRejectDialog}
              disabled={isProcessing}
            >
              Batal
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-lg border-red-200 bg-white px-3 text-sm font-medium text-red-600 hover:!border-red-200 hover:!bg-red-50"
              onClick={rejectPR}
              disabled={isProcessing || !rejectionReason.trim()}
            >
              {processing?.action === "reject" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {processing?.action === "reject" ? "Menolak..." : "Tolak"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
