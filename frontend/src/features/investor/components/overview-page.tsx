"use client";

import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CalendarCheck, Coins, Dumbbell, Gauge, PiggyBank, UserMinus, UserPlus, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatNumber, formatRupiah, formatRupiahCompact } from "@/lib/format";
import { INVESTOR_KEYS, investorApi, STREAMS, STREAM_LABELS, type Compared } from "../api";
import { changeLabel, percent } from "../format";
import { BranchChart, StreamChart } from "./charts";
import { BranchFilter, QueryState, useBranches } from "./shared";

/** Petunjuk tile: nilai periode sebelumnya dan perubahannya. */
function versus(c: Compared, label: string, money = true): string {
  const prev = money ? formatRupiahCompact(c.previous) : formatNumber(c.previous);
  const change = changeLabel(c.change);
  return change ? `${change} vs ${label} (${prev})` : `${label}: ${prev}`;
}

/** Investor → Ringkasan: KPI hari ini, bulan dan tahun berjalan, 90 hari pendapatan per stream dan cabang. */
export function InvestorOverviewPage() {
  const [branchId, setBranchId] = useState("");
  const branches = useBranches();
  const overview = useQuery({
    queryKey: INVESTOR_KEYS.overview(branchId),
    queryFn: () => investorApi.overview(branchId),
    placeholderData: keepPreviousData,
  });
  const d = overview.data;
  const names = Object.fromEntries((branches.data ?? []).map((b) => [b.id, b.name]));

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Investor"
        title="Ringkasan Investor"
        description={d ? `Posisi ${formatDate(d.today)}; angka dibandingkan dengan periode sebelumnya yang sama panjang.` : "Memuat ringkasan..."}
      />
      <BranchFilter value={branchId} onChange={setBranchId} branches={branches.data} />
      <QueryState loading={overview.isPending} error={overview.error} />
      {d && (
        <>
          <section aria-label="Pendapatan" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label="Pendapatan hari ini" value={formatRupiahCompact(d.revenue.today.value)} hint={versus(d.revenue.today, "kemarin")} icon={<Banknote />} tone="success" />
            <StatCard label="Bulan berjalan" value={formatRupiahCompact(d.revenue.mtd.value)} hint={versus(d.revenue.mtd, "bulan lalu")} icon={<Banknote />} tone="success" />
            <StatCard label="Tahun berjalan" value={formatRupiahCompact(d.revenue.ytd.value)} hint={versus(d.revenue.ytd, "tahun lalu")} icon={<Banknote />} tone="success" />
          </section>
          <section aria-label="Member dan kelas" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Member aktif 30 hari" value={formatNumber(d.members.active)} hint={`Periode sebelumnya ${formatNumber(d.members.previous_active)}`} icon={<Users />} />
            <StatCard label="Member baru bulan ini" value={formatNumber(d.members.new.value)} hint={versus(d.members.new, "bulan lalu", false)} icon={<UserPlus />} />
            <StatCard label="Churn 30 hari" value={`${formatNumber(percent(d.members.churn_rate), 1)}%`} hint={`${formatNumber(d.members.churned)} member tidak kembali`} icon={<UserMinus />} tone="warning" />
            <StatCard label="Check-in kelas 30 hari" value={formatNumber(d.classes.checked_in)} hint={`${formatNumber(d.classes.sessions)} sesi; tidak hadir ${formatNumber(percent(d.classes.no_show_rate), 1)}%`} icon={<CalendarCheck />} />
            <StatCard label="Isi kelas rata-rata" value={`${formatNumber(percent(d.classes.avg_fill), 1)}%`} hint="Kursi terisi per sesi, 30 hari" icon={<Gauge />} />
            <StatCard label="Sesi PT bulan ini" value={formatNumber(d.pt_sessions.value)} hint={versus(d.pt_sessions, "bulan lalu", false)} icon={<Dumbbell />} />
            <StatCard label="ARK Coin beredar" value={formatRupiahCompact(d.ark_coin_outstanding)} hint="Saldo dompet member, seluruh cabang" icon={<Coins />} tone="info" />
            <StatCard
              label="Pendapatan ditangguhkan"
              value={formatRupiahCompact(d.deferred_revenue.total)}
              hint={`Kredit ${formatRupiahCompact(d.deferred_revenue.credits)}, pass ${formatRupiahCompact(d.deferred_revenue.passes)}`}
              icon={<PiggyBank />}
              tone="info"
            />
          </section>

          <Card className="p-4">
            <h3 className="text-sm font-semibold">Bulan berjalan per stream</h3>
            <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {STREAMS.map((s) => (
                <div key={s}>
                  <dt className="text-xs text-muted-foreground">{STREAM_LABELS[s]}</dt>
                  <dd className="text-base font-semibold tabular-nums">{formatRupiah(d.revenue.mtd_streams[s] ?? 0)}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Tabs defaultValue="stream" className="w-full flex-col">
            <TabsList variant="line">
              <TabsTrigger value="stream">Per stream</TabsTrigger>
              <TabsTrigger value="cabang">Per cabang</TabsTrigger>
            </TabsList>
            <TabsContent value="stream">
              <StreamChart daily={d.daily} />
            </TabsContent>
            <TabsContent value="cabang">
              <BranchChart daily={d.daily} names={names} />
            </TabsContent>
          </Tabs>

          <DigestCard />
        </>
      )}
    </div>
  );
}

/** Kirim ringkasan harian: setelan email per investor. */
function DigestCard() {
  const client = useQueryClient();
  const digest = useQuery({ queryKey: INVESTOR_KEYS.digest, queryFn: investorApi.digest });
  const toggle = useMutation({
    mutationFn: investorApi.setDigest,
    onSuccess: (data) => client.setQueryData(INVESTOR_KEYS.digest, data),
  });
  const enabled = toggle.variables ?? digest.data?.enabled ?? false;
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <h3 className="text-sm font-semibold" id="digest-label">
          Kirim ringkasan harian
        </h3>
        <p className="text-xs text-muted-foreground">Email setiap pagi pukul 07.00 WIB berisi pendapatan kemarin, bulan berjalan, member dan kelas.</p>
        {toggle.error && <p className="mt-1 text-xs text-danger">{toggle.error.message}</p>}
      </div>
      <Switch aria-labelledby="digest-label" checked={enabled} disabled={digest.isPending || toggle.isPending} onCheckedChange={(on) => toggle.mutate(on)} />
    </Card>
  );
}
