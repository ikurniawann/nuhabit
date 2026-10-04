import Link from "next/link";
import { Gift, History, ReceiptText, TicketCheck } from "lucide-react";
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import type { CrmLedger, CrmRedemption, PosOrder } from "../types";
import { HistoryCard } from "./member-detail-ui";

/** Reward & privilege, riwayat redeem, riwayat XP, dan order terakhir. */
export function MemberHistorySection({
  lifetimeXp,
  redemptions,
  xpLedger,
  recentOrders,
}: {
  lifetimeXp: number;
  redemptions: CrmRedemption[];
  xpLedger: CrmLedger[];
  recentOrders: PosOrder[];
}) {
  return (
    <>
      <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950">
              <Gift className="size-4" />
              Reward & Privilege
            </h3>
            <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
              {formatNumber(lifetimeXp)} XP
            </span>
          </div>

          <div className="mt-4 space-y-3 text-sm text-slate-600">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              XP adalah skor seumur hidup dan tidak pernah dipotong. XP menentukan tier, membuka privilege produk
              khusus di kasir, dan menjadi syarat kelayakan menukar reward.
              <Link
                href="/dashboard/crm/rewards"
                className="mt-2 inline-flex items-center gap-1.5 font-medium text-slate-900 underline underline-offset-2"
              >
                <Gift className="size-3.5" />
                Kelola &amp; klaim reward
              </Link>
            </div>
          </div>
        </div>

        <HistoryCard
          icon={TicketCheck}
          title="Redemption History"
          countLabel={`${formatNumber(redemptions.length)} records`}
          empty={redemptions.length === 0 ? "Belum ada redemption." : null}
        >
          {redemptions.map((redemption) => (
            <div key={redemption.id} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900">
                  {redemption.reward?.name || redemption.redemption_number}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {formatDateTime(redemption.requested_at)} · {redemption.status}
                  {redemption.voucher_code ? ` · ${redemption.voucher_code}` : ""}
                </div>
              </div>
              <div className="text-right text-xs text-slate-500">
                syarat {formatNumber(redemption.min_xp_at_redeem)} XP
              </div>
            </div>
          ))}
        </HistoryCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <HistoryCard
          icon={History}
          title="XP History"
          countLabel={`${formatNumber(xpLedger.length)} records`}
          empty={xpLedger.length === 0 ? "Belum ada XP history." : null}
        >
          {xpLedger.map((ledger) => (
            <div key={ledger.id} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900">
                  {ledger.description || `${ledger.source_channel} ${ledger.source_type}`}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {formatDateTime(ledger.created_at)} · Balance {formatNumber(ledger.balance_after)}
                </div>
              </div>
              <div className={`text-sm font-semibold ${ledger.xp_delta >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                {ledger.xp_delta >= 0 ? "+" : ""}
                {formatNumber(ledger.xp_delta)}
              </div>
            </div>
          ))}
        </HistoryCard>

        <HistoryCard
          icon={ReceiptText}
          title="Recent Orders"
          countLabel={`${formatNumber(recentOrders.length)} orders`}
          empty={recentOrders.length === 0 ? "Belum ada transaksi." : null}
        >
          {recentOrders.map((order) => (
            <div key={order.id} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900">{order.order_number}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {formatDateTime(order.ordered_at)} · {order.payment_status}
                </div>
              </div>
              <div className="text-sm font-semibold text-slate-950">{formatRupiah(order.total_amount)}</div>
            </div>
          ))}
        </HistoryCard>
      </section>
    </>
  );
}
