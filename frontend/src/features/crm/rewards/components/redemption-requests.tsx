"use client";

import { CheckCircle2, Gift, X } from "lucide-react";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { Redemption } from "../types";
import {
  REDEMPTION_ACTION_VERBS,
  REDEMPTION_STATUS_LABELS,
  REDEMPTION_STATUS_STYLES,
  type RedemptionAction,
} from "../reward-form";
import { useUpdateRedemption } from "../mutations";
import { IconButton } from "./rewards-ui";

/** Permintaan redeem dari portal: setujui → serahkan di venue, atau batalkan. */
export function RedemptionRequests({
  redemptions,
  loading,
  statusFilter,
  onStatusFilterChange,
  onResult,
}: {
  redemptions: Redemption[];
  loading: boolean;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  onResult: (result: { error: string | null; message: string | null }) => void;
}) {
  const updateMutation = useUpdateRedemption();

  async function act(redemption: Redemption, action: RedemptionAction) {
    onResult({ error: null, message: null });
    try {
      await updateMutation.mutateAsync({ id: redemption.id, action });
      onResult({ error: null, message: `${redemption.redemption_number} ${REDEMPTION_ACTION_VERBS[action]}.` });
    } catch (err) {
      onResult({ error: err instanceof Error ? err.message : "Gagal memperbarui permintaan redeem", message: null });
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Permintaan Redeem</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Permintaan dari portal member perlu disetujui lalu diserahkan di venue.
          </p>
        </div>
        <select
          value={statusFilter}
          onChange={(event) => onStatusFilterChange(event.target.value)}
          className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100 sm:w-48"
        >
          <option value="pending">Menunggu</option>
          <option value="approved">Disetujui</option>
          <option value="fulfilled">Diserahkan</option>
          <option value="cancelled">Dibatalkan</option>
          <option value="all">Semua status</option>
        </select>
      </div>

      {loading ? (
        <div className="px-4 py-12 text-center text-sm text-slate-500">Memuat permintaan...</div>
      ) : redemptions.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-slate-500">Tidak ada permintaan pada status ini.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {redemptions.map((redemption) => {
            const busy = updateMutation.isPending && updateMutation.variables?.id === redemption.id;
            const open = redemption.status === "pending" || redemption.status === "approved";

            return (
              <div key={redemption.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[1fr_200px_240px] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-950">{redemption.reward_name}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${REDEMPTION_STATUS_STYLES[redemption.status]}`}
                    >
                      {REDEMPTION_STATUS_LABELS[redemption.status]}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
                      {redemption.channel === "portal" ? "Portal member" : "Kasir"}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span className="font-mono">{redemption.redemption_number}</span>
                    <span>{formatDateTime(redemption.requested_at)}</span>
                  </div>
                </div>

                <div className="text-sm">
                  <div className="font-medium text-slate-800">{redemption.customer_name || "Member"}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{redemption.customer_phone || "-"}</div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {formatNumber(redemption.total_xp_at_redeem)} XP saat ajukan
                    {" · syarat "}
                    {formatNumber(redemption.min_xp_at_redeem)}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 lg:justify-end">
                  {redemption.status === "pending" && (
                    <IconButton onClick={() => void act(redemption, "approve")} disabled={busy} icon={CheckCircle2}>
                      Setujui
                    </IconButton>
                  )}
                  {open && (
                    <>
                      <IconButton onClick={() => void act(redemption, "fulfill")} disabled={busy} icon={Gift} tone="primary">
                        Serahkan
                      </IconButton>
                      <IconButton onClick={() => void act(redemption, "cancel")} disabled={busy} icon={X} tone="danger">
                        Batalkan
                      </IconButton>
                    </>
                  )}
                  {redemption.status === "fulfilled" && (
                    <span className="text-xs text-slate-400">Diserahkan {formatDateTime(redemption.fulfilled_at)}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
