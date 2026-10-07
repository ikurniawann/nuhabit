"use client";

import { useState } from "react";
import { Gift, Search, UserPlus } from "lucide-react";
import { formatNumber } from "@/lib/format";
import type { Reward } from "../types";
import { useClaimMembers } from "../queries";
import { useClaimRedemption } from "../mutations";
import { selectClass } from "./rewards-ui";

/** Klaim reward di venue: cari member, pilih reward, langsung ditandai diserahkan. */
export function RewardClaimPanel({
  rewards,
  onResult,
}: {
  rewards: Reward[];
  onResult: (result: { error: string | null; message: string | null }) => void;
}) {
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [rewardId, setRewardId] = useState("");
  const claimMutation = useClaimRedemption();
  const membersQuery = useClaimMembers(customerId ? "" : search);
  const options = membersQuery.data ?? [];

  async function claim() {
    onResult({ error: null, message: null });
    try {
      await claimMutation.mutateAsync({ customer_id: customerId, reward_id: rewardId });
      const reward = rewards.find((item) => item.id === rewardId);
      setSearch("");
      setCustomerId("");
      setRewardId("");
      onResult({ error: null, message: `${reward?.name ?? "Reward"} berhasil diserahkan ke member.` });
    } catch (err) {
      onResult({ error: err instanceof Error ? err.message : "Gagal klaim reward", message: null });
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
          <UserPlus className="size-4" />
          Klaim Reward di Venue
        </h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Untuk member yang datang langsung — reward ditandai diserahkan seketika.
        </p>
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
        <div className="space-y-1">
          <span className="text-xs font-medium text-slate-500">Cari member</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setCustomerId("");
              }}
              placeholder="Nama atau nomor HP..."
              className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
            />
          </div>
          {search.trim().length > 0 && !customerId && (
            <div className="max-h-40 overflow-y-auto rounded-md border border-slate-200">
              {membersQuery.isLoading ? (
                <div className="px-3 py-2 text-xs text-slate-500">Mencari...</div>
              ) : options.length === 0 ? (
                <div className="px-3 py-2 text-xs text-slate-500">Member tidak ditemukan.</div>
              ) : (
                options.map((option) => (
                  <button
                    key={option.customer_id}
                    type="button"
                    onClick={() => {
                      setCustomerId(option.customer_id);
                      setSearch(`${option.name} · ${option.phone}`);
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition hover:bg-slate-50"
                  >
                    <span className="truncate font-medium text-slate-800">{option.name}</span>
                    <span className="shrink-0 text-slate-500">
                      {option.phone} · {formatNumber(option.total_xp)} XP
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <label className="space-y-1">
          <span className="text-xs font-medium text-slate-500">Reward</span>
          <select value={rewardId} onChange={(event) => setRewardId(event.target.value)} className={selectClass}>
            <option value="">Pilih reward...</option>
            {rewards
              .filter((reward) => reward.is_active)
              .map((reward) => (
                <option key={reward.id} value={reward.id}>
                  {reward.name} — min {formatNumber(reward.min_xp)} XP
                </option>
              ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => void claim()}
          disabled={!customerId || !rewardId || claimMutation.isPending}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
        >
          <Gift className="size-4" />
          Klaim
        </button>
      </div>
    </section>
  );
}
