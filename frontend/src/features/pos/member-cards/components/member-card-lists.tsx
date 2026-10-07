"use client";

import { Ban, CheckCircle2, HandCoins, Unlink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { CARD_UNLINK_REASON_LABELS } from "@/lib/pos/card-unlink";
import { REFUND_STATUS_LABELS, type RefundStatus } from "@/lib/pos/member-refund";
import type { MemberCardRow, RefundRequestRow, UnlinkLogRow } from "../types";

const tanggal = (iso: string | null) => formatDateTime(iso, "—");

const STATUS_CLASS: Record<RefundStatus, string> = {
  requested: "border-amber-300 bg-amber-50 text-amber-800",
  completed: "border-emerald-300 bg-emerald-50 text-emerald-800",
  cancelled: "border-gray-300 bg-gray-50 text-gray-600",
};

export function OpenRefundRequests({
  requests,
  onComplete,
  onCancel,
}: {
  requests: RefundRequestRow[];
  onComplete: (request: RefundRequestRow) => void;
  onCancel: (request: RefundRequestRow) => void;
}) {
  if (requests.length === 0) return null;
  return (
    <div>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-amber-700">
        <HandCoins className="h-4 w-4" /> Permintaan refund menunggu Finance ({requests.length})
      </h2>
      <Card className="border-amber-200">
        <CardContent className="divide-y p-0">
          {requests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-semibold text-gray-900">{r.name || r.phone}</p>
                <p className="text-xs text-gray-500">
                  {r.phone} · diajukan {r.requested_by_name || "—"} · {tanggal(r.requested_at)}
                  {r.notes ? <> · “{r.notes}”</> : null}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">Saldo saat ini</p>
                <p className="font-semibold text-emerald-700">{formatRupiah(r.current_balance)}</p>
                {Number(r.current_balance) !== Number(r.requested_amount) ? (
                  <p className="text-[11px] text-amber-700">saat diajukan {formatRupiah(r.requested_amount)}</p>
                ) : null}
              </div>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" className="h-10 gap-1.5 text-gray-600" onClick={() => onCancel(r)}>
                  <Ban className="h-4 w-4" /> Batalkan
                </Button>
                <Button className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => onComplete(r)}>
                  <CheckCircle2 className="h-4 w-4" /> Refund Completed
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function MemberCardGrid({
  members,
  onUnlink,
  onRefund,
}: {
  members: MemberCardRow[];
  onUnlink: (member: MemberCardRow) => void;
  onRefund: (member: MemberCardRow) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {members.map((m) => (
        <Card key={m.id}>
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-gray-900">{m.name || "—"}</p>
                <p className="truncate text-sm text-gray-500">{m.phone}</p>
              </div>
              {m.membership_tier ? <Badge variant="outline">{m.membership_tier}</Badge> : null}
            </div>
            <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">UID kartu</span>
                <span className="font-mono font-medium text-gray-800">{m.nfc_uid}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-gray-500">Saldo ARK</span>
                <span className="font-semibold text-emerald-700">{formatRupiah(m.ark_coin_balance)}</span>
              </div>
              <div className="mt-1 flex justify-between text-xs text-gray-400">
                <span>Kartu aktif sejak</span>
                <span>{tanggal(m.card_issued_at)}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="h-11 gap-2 border-red-200 text-red-700 hover:bg-red-50"
                onClick={() => onUnlink(m)}
              >
                <Unlink className="h-4 w-4" /> Unlink
              </Button>
              <Button
                variant="outline"
                className="h-11 gap-2 border-amber-300 text-amber-800 hover:bg-amber-50"
                onClick={() => onRefund(m)}
              >
                <HandCoins className="h-4 w-4" /> Refund
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function RefundHistory({ requests }: { requests: RefundRequestRow[] }) {
  if (requests.length === 0) return null;
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Riwayat refund</h2>
      <Card>
        <CardContent className="divide-y p-0">
          {requests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <span className="font-medium text-gray-900">{r.name || r.phone}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[r.status]}`}>
                {REFUND_STATUS_LABELS[r.status]}
              </span>
              <span className="font-semibold text-gray-800">
                {formatRupiah(r.status === "completed" ? r.refunded_amount : r.requested_amount)}
              </span>
              {r.status === "completed" && r.completion_notes ? <span className="text-gray-600">“{r.completion_notes}”</span> : null}
              {r.status === "cancelled" && r.cancel_reason ? <span className="text-gray-600">“{r.cancel_reason}”</span> : null}
              <span className="ml-auto text-xs text-gray-400">
                {r.status === "completed"
                  ? `selesai ${tanggal(r.completed_at)} · ${r.completed_by_name || "—"} · PIN ${r.approved_by_name || "supervisor"}`
                  : `dibatalkan ${tanggal(r.cancelled_at)} · ${r.cancelled_by_name || "—"}`}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function UnlinkHistory({ logs }: { logs: UnlinkLogRow[] }) {
  if (logs.length === 0) return null;
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Riwayat unlink terakhir</h2>
      <Card>
        <CardContent className="divide-y p-0">
          {logs.map((log) => (
            <div key={log.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <span className="font-medium text-gray-900">{log.name || log.phone}</span>
              <span className="font-mono text-xs text-gray-500">{log.nfc_uid}</span>
              <Badge variant="outline">{CARD_UNLINK_REASON_LABELS[log.reason] ?? log.reason}</Badge>
              {log.notes ? <span className="text-gray-600">“{log.notes}”</span> : null}
              <span className="ml-auto text-xs text-gray-400">
                saldo saat unlink {formatRupiah(log.balance_at_unlink)} · {log.unlinked_by_name || "—"} · {tanggal(log.created_at)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
