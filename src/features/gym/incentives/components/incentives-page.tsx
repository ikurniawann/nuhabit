"use client";

import { useState } from "react";
import { BadgeCheck, CalendarCheck, FileText, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatNumber, formatRupiah } from "@/lib/format";
import { currentMonth } from "../api";
import { usePayouts, useStatements } from "../queries";
import { PayoutsTab } from "./payouts-tab";
import { SchemesTab } from "./schemes-tab";
import { monthLabel } from "./shared";
import { StatementsTab } from "./statements-tab";

/** Gym → Insentif Coach: statement bulanan per coach, payout, dan skema honor. */
export function IncentivesPage() {
  const [month, setMonth] = useState(currentMonth);
  const statements = useStatements(month);
  const payouts = usePayouts(month);

  const rows = statements.data ?? [];
  const live = (payouts.data ?? []).filter((p) => p.status !== "void");
  const total = rows.reduce((sum, s) => sum + s.totals.totalIdr, 0);
  const sessions = rows.reduce((sum, s) => sum + s.totals.sessions, 0);
  const paid = live.filter((p) => p.status === "paid");
  const waiting = live.filter((p) => p.status === "draft" || p.status === "approved");

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym · Insentif"
        title="Insentif Coach"
        description="Honor coach dihitung dari kelas yang selesai: honor sesi, per peserta yang hadir, bonus kelas penuh, dikurangi no-show. Payout membekukan statement satu bulan."
        actions={
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Bulan</span>
            <Input
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="w-44"
              aria-label="Bulan statement"
            />
          </label>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <StatCard label={`Honor ${monthLabel(month)}`} value={formatRupiah(total)} icon={<Wallet />} tone="ink" />
        <StatCard label="Kelas selesai" value={formatNumber(sessions)} icon={<CalendarCheck />} />
        <StatCard
          label="Menunggu diproses"
          value={formatNumber(waiting.length)}
          unit="payout"
          icon={<FileText />}
          tone={waiting.length ? "warning" : "default"}
        />
        <StatCard
          label="Sudah dibayar"
          value={formatRupiah(paid.reduce((sum, p) => sum + p.total_idr, 0))}
          hint={`${formatNumber(paid.length)} payout`}
          icon={<BadgeCheck />}
          tone={paid.length ? "success" : "default"}
        />
      </div>

      <Tabs defaultValue="statements" className="w-full flex-col">
        <TabsList>
          <TabsTrigger value="statements">Statement</TabsTrigger>
          <TabsTrigger value="payouts">Payout</TabsTrigger>
          <TabsTrigger value="schemes">Skema honor</TabsTrigger>
        </TabsList>
        <TabsContent value="statements" className="mt-4">
          <StatementsTab month={month} query={statements} />
        </TabsContent>
        <TabsContent value="payouts" className="mt-4">
          <PayoutsTab month={month} query={payouts} />
        </TabsContent>
        <TabsContent value="schemes" className="mt-4">
          <SchemesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
