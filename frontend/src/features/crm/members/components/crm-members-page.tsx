"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Coins,
  Crown,
  RefreshCw,
  Search,
  Sparkles,
  UserPlus,
  UserRound,
} from "lucide-react";
import type { CrmMember } from "../types";
import { useMemberList } from "../queries";
import { useEnrollMember } from "../mutations";
import { tierName } from "../member-detail";
import { formatNumber, formatRupiah } from "@/lib/format";

const NONE: CrmMember[] = [];

export function CrmMembersPage() {
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState("all");

  const { data, isLoading, isFetching, error, refetch } = useMemberList({
    search: search.trim() || undefined,
    tier,
    limit: 100,
  });

  const enrollMutation = useEnrollMember();

  const members = data?.members ?? NONE;
  const schemaReady = data?.schemaReady ?? false;
  const errorMessage = error instanceof Error ? error.message : null;
  const loading = isLoading || isFetching;

  const summary = useMemo(() => {
    const totalLifetimeXp = members.reduce((sum, member) => sum + member.lifetime_xp, 0);
    const totalSpend = members.reduce((sum, member) => sum + (member.customer?.total_spent ?? 0), 0);
    const totalArk = members.reduce((sum, member) => sum + (member.customer?.ark_coin_balance ?? 0), 0);

    return { totalLifetimeXp, totalSpend, totalArk };
  }, [members]);

  function applyFilters() {
    void refetch();
  }

  async function handleEnroll(member: CrmMember) {
    if (!member.customer_id) return;

    try {
      await enrollMutation.mutateAsync({
        customerId: member.customer_id,
        metadata: { enrolled_by: "crm_members_list" },
      });
    } catch {
      // error surfaced via enrollMutation.error
    }
  }

  const enrollError =
    enrollMutation.error instanceof Error ? enrollMutation.error.message : null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/dashboard/crm" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-900">
              <ArrowLeft className="size-4" />
              CRM Dashboard
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal text-slate-950">Members</h1>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-60"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {(errorMessage || enrollError) && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage || enrollError}
          </div>
        )}

        {!schemaReady && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            CRM member profile belum aktif. Data sementara membaca POS customer.
          </div>
        )}

        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={UserRound} label="Members" value={formatNumber(members.length)} />
          <MetricCard icon={Sparkles} label="ARK Coin" value={formatNumber(summary.totalArk)} />
          <MetricCard icon={Crown} label="Lifetime XP" value={formatNumber(summary.totalLifetimeXp)} />
          <MetricCard icon={Coins} label="Total Spend" value={formatRupiah(summary.totalSpend)} />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-[1fr_180px_auto]">
              <label className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") applyFilters();
                  }}
                  placeholder="Cari nama, phone, email, kode member"
                  className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                />
              </label>
              <select
                value={tier}
                onChange={(event) => setTier(event.target.value)}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
              >
                <option value="all">Semua tier</option>
                <option value="regular">Regular</option>
                <option value="bronze">Bronze</option>
                <option value="silver">Silver</option>
                <option value="gold">Gold</option>
              </select>
              <button
                type="button"
                onClick={applyFilters}
                className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                Apply
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase text-slate-500">
                    <th className="px-4 py-3">Member</th>
                    <th className="px-4 py-3">Tier</th>
                    <th className="px-4 py-3 text-right">ARK Coin</th>
                    <th className="px-4 py-3 text-right">Lifetime XP</th>
                    <th className="px-4 py-3 text-right">Spend</th>
                    <th className="px-4 py-3 text-right">Visit</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">Memuat members...</td>
                    </tr>
                  ) : members.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">Belum ada member.</td>
                    </tr>
                  ) : (
                    members.map((member) => (
                      <tr
                        key={member.id}
                        className="transition hover:bg-slate-50"
                      >
                        <td className="px-4 py-3">
                          <Link href={`/dashboard/crm/members/${member.id}`} className="font-medium text-slate-950 transition hover:text-slate-600">
                            {member.customer?.name || "Customer"}
                          </Link>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {member.member_code} · {member.customer?.phone || "-"}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-sm bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                            {tierName(member)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-emerald-700">{formatNumber(member.customer?.ark_coin_balance)}</td>
                        <td className="px-4 py-3 text-right text-sm text-slate-700">{formatNumber(member.lifetime_xp)}</td>
                        <td className="px-4 py-3 text-right text-sm text-slate-700">{formatRupiah(member.customer?.total_spent)}</td>
                        <td className="px-4 py-3 text-right text-sm text-slate-700">{formatNumber(member.customer?.visit_count)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            {member.id.startsWith("pos-") && (
                              <button
                                type="button"
                                onClick={() => void handleEnroll(member)}
                                disabled={enrollMutation.isPending && enrollMutation.variables?.customerId === member.customer_id}
                                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-slate-950 px-3 text-xs font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                              >
                                <UserPlus className="size-3.5" />
                                {enrollMutation.isPending && enrollMutation.variables?.customerId === member.customer_id ? "Aktif..." : "Aktifkan"}
                              </button>
                            )}
                            <Link
                              href={`/dashboard/crm/members/${member.id}`}
                              className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                            >
                              Detail
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof UserRound;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex size-10 items-center justify-center rounded-md bg-slate-100 text-slate-700">
        <Icon className="size-5" />
      </div>
      <div className="text-2xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}
