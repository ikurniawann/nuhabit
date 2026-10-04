"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Boxes, CheckCircle2, ClipboardList, Gift, Info, RefreshCw } from "lucide-react";
import { formatNumber } from "@/lib/format";
import type { Reward, RewardForm } from "../types";
import { useRedemptionsList, useRewardsList } from "../queries";
import { useDeleteReward, useSaveReward, useToggleReward } from "../mutations";
import {
  DEFAULT_REWARD_FORM,
  countPending,
  duplicateRewardForm,
  filterRewards,
  rewardFormToPayload,
  rewardToForm,
  summarizeRewards,
} from "../reward-form";
import { MetricCard, TabButton } from "./rewards-ui";
import { RewardFormPanel } from "./reward-form-panel";
import { RewardCatalogList } from "./reward-catalog-list";
import { RewardClaimPanel } from "./reward-claim-panel";
import { RedemptionRequests } from "./redemption-requests";

type Feedback = { error: string | null; message: string | null };

const NO_FEEDBACK: Feedback = { error: null, message: null };
const NONE: never[] = [];

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

export function CrmRewardsPage() {
  const [tab, setTab] = useState<"catalog" | "requests">("catalog");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [form, setForm] = useState<RewardForm>(DEFAULT_REWARD_FORM);
  const [feedback, setFeedback] = useState<Feedback>(NO_FEEDBACK);

  const { data, isLoading, isFetching, error, refetch } = useRewardsList({ reward_type: typeFilter });
  const redemptionsQuery = useRedemptionsList({ status: statusFilter });
  const saveMutation = useSaveReward();
  const toggleMutation = useToggleReward();
  const deleteMutation = useDeleteReward();

  const rewards: Reward[] = data?.rewards ?? NONE;
  const redemptions = redemptionsQuery.data ?? NONE;
  const loading = isLoading || isFetching;
  const queryError = error instanceof Error ? error.message : null;
  // Peran tanpa izin baca redemption (mis. HRD) tetap boleh melihat katalog —
  // errornya hanya relevan saat tab Permintaan Redeem dibuka.
  const redemptionsError =
    tab === "requests" && redemptionsQuery.error instanceof Error ? redemptionsQuery.error.message : null;
  const bannerError = queryError || redemptionsError || feedback.error;

  const filteredRewards = useMemo(() => filterRewards(rewards, search), [rewards, search]);
  const summary = useMemo(() => summarizeRewards(rewards), [rewards]);
  const pendingCount = useMemo(() => countPending(redemptions), [redemptions]);

  function openInForm(next: RewardForm) {
    setTab("catalog");
    setForm(next);
  }

  async function saveReward() {
    setFeedback(NO_FEEDBACK);
    try {
      await saveMutation.mutateAsync(rewardFormToPayload(form));
      setForm(DEFAULT_REWARD_FORM);
      setFeedback({ error: null, message: "Reward berhasil disimpan." });
    } catch (err) {
      setFeedback({ error: errorText(err, "Gagal menyimpan reward"), message: null });
    }
  }

  async function toggleReward(reward: Reward) {
    setFeedback(NO_FEEDBACK);
    try {
      await toggleMutation.mutateAsync(reward);
      if (form.id === reward.id) setForm((current) => ({ ...current, is_active: !reward.is_active }));
      setFeedback({
        error: null,
        message: `Reward ${reward.name} ${reward.is_active ? "disembunyikan dari member" : "dibuka untuk member"}.`,
      });
    } catch (err) {
      setFeedback({ error: errorText(err, "Gagal update status reward"), message: null });
    }
  }

  async function deleteReward(reward: Reward) {
    setFeedback(NO_FEEDBACK);
    try {
      await deleteMutation.mutateAsync(reward.id);
      if (form.id === reward.id) setForm(DEFAULT_REWARD_FORM);
      setFeedback({ error: null, message: `Reward ${reward.name} berhasil dihapus.` });
    } catch (err) {
      setFeedback({ error: errorText(err, "Gagal hapus reward"), message: null });
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link
              href="/dashboard/crm"
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-900"
            >
              <ArrowLeft className="size-4" />
              CRM Dashboard
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal text-slate-950">Rewards</h1>
            <p className="mt-1 text-sm text-slate-500">
              Atur reward mana yang bisa ditukar member dan berapa kali jatahnya.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void refetch();
              void redemptionsQuery.refetch();
            }}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-60"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        <div className="flex items-start gap-2.5 rounded-md border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          <Info className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong className="font-semibold">XP tidak dipotong saat redeem.</strong> Angka &ldquo;Min XP&rdquo; adalah
            syarat kelayakan — member dengan XP seumur hidup di atas ambang itu berhak menukar reward. Yang membatasi
            pengambilan berulang adalah kuota per member.
          </p>
        </div>

        {(bannerError || feedback.message) && (
          <div
            className={`rounded-md border px-4 py-3 text-sm ${
              bannerError ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {bannerError || feedback.message}
          </div>
        )}

        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Gift} label="Rewards" value={formatNumber(rewards.length)} />
          <MetricCard icon={CheckCircle2} label="Bisa di-redeem" value={formatNumber(summary.active)} />
          <MetricCard icon={Boxes} label="Stok" value={formatNumber(summary.stock)} />
          <MetricCard icon={ClipboardList} label="Menunggu approval" value={formatNumber(pendingCount)} />
        </section>

        <div className="flex gap-1 rounded-md border border-slate-200 bg-white p-1 shadow-sm">
          <TabButton active={tab === "catalog"} onClick={() => setTab("catalog")} icon={Gift}>
            Katalog Reward
          </TabButton>
          <TabButton active={tab === "requests"} onClick={() => setTab("requests")} icon={ClipboardList}>
            Permintaan Redeem
            {pendingCount > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                {pendingCount}
              </span>
            )}
          </TabButton>
        </div>

        {tab === "catalog" ? (
          <section className="grid gap-4 xl:grid-cols-[420px_1fr]">
            <RewardFormPanel
              form={form}
              tiers={data?.tiers ?? NONE}
              saving={saveMutation.isPending}
              onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
              onReset={() => setForm(DEFAULT_REWARD_FORM)}
              onSave={() => void saveReward()}
            />
            <RewardCatalogList
              rewards={filteredRewards}
              loading={loading}
              search={search}
              onSearchChange={setSearch}
              typeFilter={typeFilter}
              onTypeFilterChange={setTypeFilter}
              isToggling={(reward) => toggleMutation.isPending && toggleMutation.variables?.id === reward.id}
              isDeleting={(reward) => deleteMutation.isPending && deleteMutation.variables === reward.id}
              onEdit={(reward) => openInForm(rewardToForm(reward))}
              onDuplicate={(reward) => openInForm(duplicateRewardForm(reward))}
              onToggle={(reward) => void toggleReward(reward)}
              onDelete={(reward) => void deleteReward(reward)}
            />
          </section>
        ) : (
          <>
            <RewardClaimPanel rewards={rewards} onResult={setFeedback} />
            <RedemptionRequests
              redemptions={redemptions}
              loading={redemptionsQuery.isLoading}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              onResult={setFeedback}
            />
          </>
        )}
      </div>
    </div>
  );
}
