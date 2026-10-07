"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { prQueryKeys } from "@/features/purchasing/pr/query-keys";
import { poQueryKeys } from "@/features/purchasing/po/query-keys";

type ApprovalAction = "approve" | "reject";

type PRApprovalActionsProps = {
  prId: string;
};

export function PRApprovalActions({ prId }: PRApprovalActionsProps) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<ApprovalAction | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const isReject = action === "reject";

  async function submitApproval() {
    if (!action) return;
    if (isReject && !reason.trim()) {
      toast.error("Alasan penolakan wajib diisi");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/purchasing/pr/${prId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reason: isReject ? reason.trim() : undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Gagal memproses persetujuan purchase request");
      }

      toast.success(
        action === "approve"
          ? "Purchase request berhasil disetujui"
          : "Purchase request berhasil ditolak"
      );
      setAction(null);
      setReason("");
      await queryClient.invalidateQueries({ queryKey: prQueryKeys.detail(prId) });
      await queryClient.invalidateQueries({ queryKey: prQueryKeys.all });
      if (action === "approve") {
        await queryClient.invalidateQueries({ queryKey: poQueryKeys.approvedPRs });
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal memproses persetujuan purchase request"
      );
    } finally {
      setLoading(false);
    }
  }

  function closeDialog() {
    if (loading) return;
    setAction(null);
    setReason("");
  }

  return (
    <>
      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="border-b border-gray-200/70 pb-3">
          <CardTitle className="text-base">Aksi Persetujuan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <Button
            type="button"
            className="purchasing-main-button w-full"
            onClick={() => setAction("approve")}
          >
            <CheckCircle className="mr-2 h-4 w-4" />
            Setujui
          </Button>
          <Button
            type="button"
            className="h-10 w-full rounded-lg border-red-200 bg-white px-3 text-sm font-medium text-red-600 hover:!border-red-200 hover:!bg-red-50"
            variant="outline"
            onClick={() => setAction("reject")}
          >
            <XCircle className="mr-2 h-4 w-4" />
            Tolak
          </Button>
        </CardContent>
      </Card>

      <Dialog open={action !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogPanel size={isReject ? "sm" : "xs"}>
          <DialogPanelHeader>
            <DialogPanelTitle>
              {isReject ? "Tolak Purchase Request" : "Setujui Purchase Request?"}
            </DialogPanelTitle>
            <DialogPanelDescription>
              {isReject
                ? "Permintaan ini akan ditolak. Pemohon dapat membuat revisi jika item masih dibutuhkan."
                : "Permintaan ini akan disetujui sebagai kebutuhan yang valid dan dapat dilanjutkan ke pembuatan purchase order."}
            </DialogPanelDescription>
          </DialogPanelHeader>

          {isReject ? (
            <DialogPanelBody>
              <div className="space-y-1.5">
                <Label htmlFor="pr-rejection-reason" className="text-xs">
                  Alasan Penolakan <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="pr-rejection-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Jelaskan alasan permintaan ini ditolak..."
                  rows={4}
                  className="resize-none text-sm"
                  disabled={loading}
                />
              </div>
            </DialogPanelBody>
          ) : (
            <DialogPanelBody />
          )}

          <DialogFooter className="px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="purchasing-secondary-button"
              onClick={closeDialog}
              disabled={loading}
            >
              Batal
            </Button>
            <Button
              type="button"
              variant={isReject ? "outline" : "default"}
              className={
                isReject
                  ? "h-10 rounded-lg border-red-200 bg-white px-3 text-sm font-medium text-red-600 hover:!border-red-200 hover:!bg-red-50"
                  : "purchasing-main-button"
              }
              onClick={submitApproval}
              disabled={loading || (isReject && !reason.trim())}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {loading
                ? isReject
                  ? "Menolak..."
                  : "Menyetujui..."
                : isReject
                  ? "Tolak"
                  : "Setujui"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </>
  );
}
