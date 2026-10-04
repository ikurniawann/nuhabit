"use client";

import { Crown, ShoppingBag, Sparkles, Ticket, User, Wallet } from "lucide-react";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";
import type { MemberContext } from "../types";

/**
 * Panel konteks member di samping chat — pembeda utama inbox ini: agent
 * langsung tahu siapa yang komplain berikut riwayat belanjanya.
 */

export function MemberContextPanel({ member }: { member: MemberContext | null }) {
  if (!member) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-400">
        <User className="size-8" />
        Nomor ini belum terdaftar sebagai member.
      </div>
    );
  }

  return (
    <div className="space-y-4 overflow-y-auto p-4">
      <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-4 text-center">
        <div className="mx-auto mb-2 grid size-12 place-items-center rounded-full bg-violet-600 text-lg font-bold text-white">
          {member.name?.slice(0, 1).toUpperCase() || "M"}
        </div>
        <div className="font-semibold text-slate-900">{member.name || "Member"}</div>
        <div className="mt-0.5 text-xs text-slate-500">+{member.phone}</div>
        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold text-violet-700 ring-1 ring-violet-100">
          <Crown className="size-3.5" />
          {member.tier_name || "Regular"}
          <span className="text-slate-400">·</span>
          {member.member_type === "card" ? "Member Kartu" : "Terdaftar"}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <StatBox icon={Sparkles} label="XP" value={formatNumber(member.total_xp)} />
        <StatBox icon={Wallet} label="ARK Coin" value={formatNumber(member.ark_coin_balance)} />
        <StatBox icon={User} label="Kunjungan" value={`${member.visit_count}×`} />
      </div>

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <ShoppingBag className="size-3.5" /> Order Terakhir
        </h3>
        {member.recent_orders.length === 0 ? (
          <p className="text-xs text-slate-400">Belum ada order.</p>
        ) : (
          <div className="space-y-1.5">
            {member.recent_orders.map((order) => (
              <div key={order.id} className="flex items-center justify-between rounded-md border border-slate-200 px-2.5 py-1.5 text-xs">
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-800">
                    {order.order_number || order.id.slice(0, 8)}
                  </div>
                  <div className="text-slate-400">
                    {formatDate(order.created_at)} · {order.status}
                  </div>
                </div>
                <div className="shrink-0 font-semibold text-slate-700">
                  {formatRupiah(order.total_amount)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Ticket className="size-3.5" /> Redemption Terakhir
        </h3>
        {member.recent_redemptions.length === 0 ? (
          <p className="text-xs text-slate-400">Belum ada redemption.</p>
        ) : (
          <div className="space-y-1.5">
            {member.recent_redemptions.map((redemption) => (
              <div key={redemption.redemption_number} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs">
                <div className="truncate font-medium text-slate-800">{redemption.reward_name}</div>
                <div className="text-slate-400">
                  {formatDate(redemption.requested_at)} · {redemption.status}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatBox({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Sparkles;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2 py-2.5">
      <Icon className="mx-auto mb-1 size-4 text-slate-400" />
      <div className="text-sm font-semibold text-slate-900">{value}</div>
      <div className="text-[10px] text-slate-400">{label}</div>
    </div>
  );
}
