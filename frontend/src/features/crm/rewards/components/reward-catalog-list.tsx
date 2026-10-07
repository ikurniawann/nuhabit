"use client";

import { BadgePercent, Boxes, CheckCircle2, Copy, EyeOff, Gift, Image as ImageIcon, Pencil, Search, Ticket, Trash2, Trophy } from "lucide-react";
import { formatNumber } from "@/lib/format";
import type { Reward } from "../types";
import { REWARD_TYPE_LABELS, SELECTABLE_REWARD_TYPES, quotaLabel, remainingStock } from "../reward-form";
import { IconButton, selectClass } from "./rewards-ui";

const TYPE_ICONS: Partial<Record<Reward["reward_type"], typeof Gift>> = {
  discount: BadgePercent,
  merchandise: Boxes,
  avatar: ImageIcon,
  voucher: Ticket,
};

export function RewardCatalogList({
  rewards,
  loading,
  search,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  isToggling,
  isDeleting,
  onEdit,
  onDuplicate,
  onToggle,
  onDelete,
}: {
  rewards: Reward[];
  loading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  typeFilter: string;
  onTypeFilterChange: (value: string) => void;
  isToggling: (reward: Reward) => boolean;
  isDeleting: (reward: Reward) => boolean;
  onEdit: (reward: Reward) => void;
  onDuplicate: (reward: Reward) => void;
  onToggle: (reward: Reward) => void;
  onDelete: (reward: Reward) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-[1fr_180px]">
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Cari reward..."
            className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
          />
        </label>
        <select value={typeFilter} onChange={(event) => onTypeFilterChange(event.target.value)} className={selectClass}>
          <option value="all">Semua jenis</option>
          {SELECTABLE_REWARD_TYPES.map((type) => (
            <option key={type} value={type}>
              {REWARD_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="px-4 py-12 text-center text-sm text-slate-500">Memuat rewards...</div>
      ) : rewards.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-slate-500">Belum ada reward.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {rewards.map((reward) => {
            const Icon = TYPE_ICONS[reward.reward_type] ?? Gift;
            const stock = remainingStock(reward);

            return (
              <div key={reward.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[1fr_150px_130px_220px] lg:items-center">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-950">{reward.name}</div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
                      <span>{reward.code}</span>
                      <span>{REWARD_TYPE_LABELS[reward.reward_type]}</span>
                      <span>{reward.required_tier?.name || "Semua tier"}</span>
                      <span className={reward.is_active ? "font-medium text-emerald-700" : "text-slate-400"}>
                        {reward.is_active ? "Bisa di-redeem" : "Disembunyikan"}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-violet-700">
                    <Trophy className="size-3.5" />
                    min {formatNumber(reward.min_xp)} XP
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">tidak dipotong</div>
                </div>

                <div className="text-sm text-slate-600">
                  {stock == null ? "Stok bebas" : `${formatNumber(stock)} sisa`}
                  <div className="mt-0.5 text-xs text-slate-400">Jatah: {quotaLabel(reward)}</div>
                </div>

                <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                  <IconButton onClick={() => onEdit(reward)} icon={Pencil}>
                    Edit
                  </IconButton>
                  <IconButton onClick={() => onDuplicate(reward)} icon={Copy}>
                    Salin
                  </IconButton>
                  <IconButton
                    onClick={() => onToggle(reward)}
                    disabled={isToggling(reward)}
                    icon={reward.is_active ? EyeOff : CheckCircle2}
                  >
                    {reward.is_active ? "Sembunyikan" : "Aktifkan"}
                  </IconButton>
                  <IconButton onClick={() => onDelete(reward)} disabled={isDeleting(reward)} icon={Trash2} tone="danger">
                    Hapus
                  </IconButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
