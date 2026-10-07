"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ClipboardDocumentCheckIcon } from "@heroicons/react/24/outline";
import { Check, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useApprovals, useDecideApproval } from "../queries";
import type { ApprovalRequestRow } from "../types";
import { formatDateTime, formatRupiah } from "@/lib/format";

const STATUS_BADGE: Record<ApprovalRequestRow["status"], string> = {
  pending: "border-0 bg-amber-100 font-normal text-amber-700",
  approved: "border-0 bg-emerald-100 font-normal text-emerald-700",
  rejected: "border-0 bg-red-100 font-normal text-red-700",
  cancelled: "border-0 bg-gray-100 font-normal text-gray-500",
};
const STATUS_LABEL: Record<ApprovalRequestRow["status"], string> = {
  pending: "Menunggu",
  approved: "Disetujui",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
};

/** EPIC-050 T-2.4 — CRM → Sales → Approval: inbox approver + status pengajuan sales. */
export function ApprovalsInboxPage() {
  const searchParams = useSearchParams();
  const [view, setView] = useState<"mine" | "all">("mine");
  const [status, setStatus] = useState<"pending" | "all">("pending");
  const [deciding, setDeciding] = useState<{ row: ApprovalRequestRow; decision: "approve" | "reject" } | null>(null);
  const [comment, setComment] = useState("");
  const approvalsQuery = useApprovals(view, status);
  const decideMutation = useDecideApproval();
  const rows = approvalsQuery.data ?? [];
  const focusId = searchParams.get("request");

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Approval</h1>
          <p className="mt-1 text-sm text-gray-500">Persetujuan diskon quotation berjenjang. Quotation baru bisa dikirim ke PIC setelah disetujui.</p>
        </div>
        <div className="flex gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
            {(["pending", "all"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setStatus(v)} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${status === v ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
                {v === "pending" ? "Menunggu" : "Semua"}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
            {(["mine", "all"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${view === v ? "bg-pink-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
                {v === "mine" ? "Saya" : "Semua"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <PurchasingListSection icon={ClipboardDocumentCheckIcon} title="Permintaan Approval" description="“Saya” = menunggu keputusan Anda atau yang Anda ajukan.">
        {approvalsQuery.isLoading ? (
          <div className="py-14 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" /></div>
        ) : rows.length === 0 ? (
          <p className="py-14 text-center text-sm text-gray-500">Tidak ada permintaan approval.</p>
        ) : (
          <ul className="divide-y divide-gray-200/60">
            {rows.map((r) => (
              <li key={r.id} className={`px-5 py-4 text-sm ${focusId === r.id ? "bg-pink-50/50" : ""}`}>
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link href={`/dashboard/sales-funnel/pipeline?deal=${r.deal_id}`} className="font-semibold text-gray-900 hover:text-pink-700 hover:underline">
                        {r.quote_number}
                      </Link>
                      <Badge className={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}{r.status === "pending" ? ` · tingkat ${r.current_level}` : ""}</Badge>
                      <Badge className="border-0 bg-red-100 font-semibold text-red-700">diskon {Number(r.discount_percent)}%</Badge>
                    </div>
                    <p className="mt-0.5 text-gray-700">
                      {r.org_name} · {r.deal_title}
                      <span className="text-gray-500"> · PIC {r.pic_name}</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      Subtotal {formatRupiah(r.subtotal)} − diskon {formatRupiah(r.discount_nominal)} = <span className="font-medium text-gray-900">{formatRupiah(r.total)}</span>
                      {r.requested_by_name ? ` · diajukan ${r.requested_by_name}` : ""} · {formatDateTime(r.created_at)}
                    </p>
                    {r.steps?.length ? (
                      <ol className="mt-2 flex flex-wrap gap-2 text-xs">
                        {r.steps.map((s) => (
                          <li key={s.level} className={`rounded-md border px-2 py-1 ${s.status === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : s.status === "rejected" ? "border-red-200 bg-red-50 text-red-700" : s.level === r.current_level && r.status === "pending" ? "border-amber-300 bg-amber-50 text-amber-800" : "border-gray-200 text-gray-500"}`}>
                            Tingkat {s.level}: {s.approver_role ?? "user"} · {s.status === "pending" ? "menunggu" : s.status}
                            {s.decided_by_name ? ` (${s.decided_by_name})` : ""}
                            {s.comment ? ` — “${s.comment}”` : ""}
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </div>
                  {r.status === "pending" && r.can_decide ? (
                    <div className="flex shrink-0 gap-2">
                      <Button type="button" size="sm" className="h-9 gap-1 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => { setComment(""); setDeciding({ row: r, decision: "approve" }); }}>
                        <Check className="h-4 w-4" /> Setujui
                      </Button>
                      <Button type="button" size="sm" variant="outline" className="h-9 gap-1 border-red-200 text-red-600 hover:bg-red-50" onClick={() => { setComment(""); setDeciding({ row: r, decision: "reject" }); }}>
                        <X className="h-4 w-4" /> Tolak
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </PurchasingListSection>

      <Dialog open={deciding !== null} onOpenChange={(o) => !o && setDeciding(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{deciding?.decision === "approve" ? "Setujui diskon?" : "Tolak diskon?"}</DialogTitle>
          </DialogHeader>
          {deciding ? (
            <p className="text-sm text-gray-600">
              {deciding.row.quote_number} · {deciding.row.org_name} · diskon {Number(deciding.row.discount_percent)}% · total {formatRupiah(deciding.row.total)}
            </p>
          ) : null}
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="Catatan untuk sales (opsional)" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)} disabled={decideMutation.isPending}>Batal</Button>
            <Button
              className={deciding?.decision === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}
              disabled={decideMutation.isPending}
              onClick={() => {
                if (!deciding) return;
                decideMutation.mutate({ id: deciding.row.id, decision: deciding.decision, comment }, { onSuccess: () => setDeciding(null) });
              }}
            >
              {decideMutation.isPending ? "Menyimpan…" : deciding?.decision === "approve" ? "Setujui" : "Tolak"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
