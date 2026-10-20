"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Banknote, CalendarCheck, Gauge, RotateCcw, UserMinus, UserPlus, Users, UserX } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { METHOD_LABELS, KIND_LABELS, type PaymentMethod } from "@/features/gym/credits/api";
import { MEMBER_KEYS, membersApi } from "@/features/gym/members/api";
import { MemberLink } from "@/features/gym/members/member-link";
import { SELECT } from "@/features/gym/shared";
import { formatDate, formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { zoneAbbr, zoneName } from "@/lib/timezone";
import { REPORT_KEYS, reportsApi, type ClassReport, type GroupStat, type MembersReport, type RevenueGroup, type RevenueReport } from "../api";
import { percent, type ReportColumn } from "../csv";
import {
  RANGE_PRESETS,
  REPORT_TABS,
  matchPreset,
  parseReportParams,
  presetRange,
  reportApiQuery,
  reportParamsToSearch,
  wibToday,
  type RangePreset,
  type ReportParams,
  type ReportTab,
} from "../params";
import { AttendanceChart, DailyBarChart } from "./charts";
import { OccupancyHeatmap } from "./heatmap";
import { ReportTable } from "./report-table";

const pct = (ratio: number) => `${formatNumber(percent(ratio), 1)}%`;

/** Zona hari laporan: zona cabang yang difilter, atau WIB untuk semua cabang. */
function zoneNote(branchId: string, branches: { id: string; timezone?: string }[] | undefined): string {
  if (!branchId) return "Semua cabang: hari dan jam dihitung dalam WIB (Asia/Jakarta).";
  const zone = branches?.find((b) => b.id === branchId)?.timezone;
  return `Hari dan jam dihitung dalam ${zoneAbbr(zone)} (${zoneName(zone)}), zona cabang ini.`;
}
const methodLabel = (key: string) => METHOD_LABELS[key as PaymentMethod] ?? "Lainnya";

/** Gym → Laporan Gym: kehadiran, okupansi, pendapatan, member dan coach per rentang tanggal dan cabang. */
export function ReportsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const today = wibToday();
  const params = parseReportParams(searchParams, today);
  const navigate = (next: ReportParams) => {
    const search = reportParamsToSearch(next, today);
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  };
  const query = reportApiQuery(params);
  const classTab = params.tab === "kehadiran" || params.tab === "okupansi" || params.tab === "coach";
  const classes = useQuery({
    queryKey: REPORT_KEYS.classes(query),
    queryFn: () => reportsApi.classes(query),
    enabled: classTab,
    placeholderData: keepPreviousData,
  });
  const revenue = useQuery({
    queryKey: REPORT_KEYS.revenue(query),
    queryFn: () => reportsApi.revenue(query),
    enabled: params.tab === "pendapatan",
    placeholderData: keepPreviousData,
  });
  const members = useQuery({
    queryKey: REPORT_KEYS.members(query),
    queryFn: () => reportsApi.members(query),
    enabled: params.tab === "member",
    placeholderData: keepPreviousData,
  });
  const branches = useQuery({ queryKey: MEMBER_KEYS.branches, queryFn: membersApi.branches, staleTime: 5 * 60_000 });
  const preset = matchPreset(params.from, params.to, today);
  const period = { from: params.from, to: params.to };

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Laporan Gym"
        description={`Kelas yang sudah berlangsung, penjualan paket, dan aktivitas member, ${formatDate(params.from)} s.d. ${formatDate(params.to)}.`}
      />

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Rentang">
            <select
              className={SELECT}
              value={preset ?? ""}
              onChange={(e) => e.target.value && navigate({ ...params, ...presetRange(e.target.value as RangePreset, today) })}
            >
              {!preset && <option value="">Rentang khusus</option>}
              {RANGE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Dari tanggal">
            <Input
              type="date"
              value={params.from}
              max={params.to}
              onChange={(e) => e.target.value && navigate({ ...params, from: e.target.value })}
            />
          </Field>
          <Field label="Sampai tanggal">
            <Input
              type="date"
              value={params.to}
              min={params.from}
              onChange={(e) => e.target.value && navigate({ ...params, to: e.target.value })}
            />
          </Field>
          <Field label="Cabang">
            <select className={SELECT} value={params.branch_id} onChange={(e) => navigate({ ...params, branch_id: e.target.value })}>
              <option value="">Semua cabang</option>
              {(branches.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{zoneNote(params.branch_id, branches.data)}</p>
      </Card>

      <Tabs value={params.tab} onValueChange={(tab) => navigate({ ...params, tab: tab as ReportTab })} className="w-full flex-col">
        <TabsList variant="line">
          {REPORT_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="kehadiran" className="mt-4">
          <Loaded query={classes}>{(d) => <AttendanceSection report={d} period={period} />}</Loaded>
        </TabsContent>
        <TabsContent value="okupansi" className="mt-4">
          <Loaded query={classes}>{(d) => <OccupancySection report={d} period={period} />}</Loaded>
        </TabsContent>
        <TabsContent value="pendapatan" className="mt-4">
          <Loaded query={revenue}>{(d) => <RevenueSection report={d} period={period} />}</Loaded>
        </TabsContent>
        <TabsContent value="member" className="mt-4">
          <Loaded query={members}>{(d) => <MembersSection report={d} period={period} />}</Loaded>
        </TabsContent>
        <TabsContent value="coach" className="mt-4">
          <Loaded query={classes}>{(d) => <CoachSection report={d} period={period} />}</Loaded>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Loaded<T>({
  query,
  children,
}: {
  query: { data?: T; isLoading: boolean; error: Error | null };
  children: (data: T) => React.ReactNode;
}) {
  if (query.isLoading) return <Card><TableNote>Memuat laporan…</TableNote></Card>;
  if (query.error || !query.data) return <Card><TableNote tone="danger">{query.error?.message ?? "Gagal memuat laporan"}</TableNote></Card>;
  return <div className="space-y-4">{children(query.data)}</div>;
}

type Period = { from: string; to: string };

const groupColumns = (first: string): ReportColumn<GroupStat>[] => [
  { label: first, value: (r) => r.name },
  { label: "Sesi", value: (r) => r.sessions, numeric: true },
  { label: "Check-in", value: (r) => r.checked_in, render: (r) => formatNumber(r.checked_in), numeric: true },
  { label: "Rata-rata terisi (%)", value: (r) => percent(r.avg_fill), render: (r) => pct(r.avg_fill), numeric: true },
  { label: "Tidak hadir (%)", value: (r) => percent(r.no_show_rate), render: (r) => pct(r.no_show_rate), numeric: true },
  { label: "Batal terlambat (%)", value: (r) => percent(r.late_cancel_rate), render: (r) => pct(r.late_cancel_rate), numeric: true },
];

function AttendanceSection({ report, period }: { report: ClassReport; period: Period }) {
  const t = report.totals;
  return (
    <>
      <h2 className="sr-only">Kehadiran</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Check-in kelas" value={formatNumber(t.checked_in)} hint={`${formatNumber(t.sessions)} sesi berlangsung`} icon={<CalendarCheck />} tone="ink" />
        <StatCard label="Rata-rata terisi" value={pct(t.avg_fill)} icon={<Gauge />} />
        <StatCard label="Tingkat tidak hadir" value={pct(t.no_show_rate)} hint={`${formatNumber(t.no_show)} booking`} icon={<UserX />} tone={t.no_show ? "warning" : "default"} />
        <StatCard label="Tingkat batal terlambat" value={pct(t.late_cancel_rate)} hint={`${formatNumber(t.late_cancel)} booking`} icon={<RotateCcw />} />
      </div>
      <AttendanceChart days={report.per_day} />
      <ReportTable
        title="Kehadiran per hari"
        rows={report.per_day}
        rowKey={(r) => r.day}
        csvName="kehadiran-harian"
        period={period}
        columns={[
          { label: "Tanggal", value: (r) => r.day, render: (r) => formatDate(r.day) },
          { label: "Check-in", value: (r) => r.checked_in, numeric: true },
          { label: "Tidak hadir", value: (r) => r.no_show, numeric: true },
          { label: "Batal terlambat", value: (r) => r.late_cancel, numeric: true },
        ]}
      />
      <ReportTable title="Kehadiran per jenis kelas" rows={report.per_class_type} rowKey={(r) => r.id} csvName="kehadiran-jenis-kelas" period={period} columns={groupColumns("Jenis kelas")} />
      <ReportTable title="Kehadiran per coach" rows={report.per_coach} rowKey={(r) => r.id || "tanpa-coach"} csvName="kehadiran-coach" period={period} columns={groupColumns("Coach")} />
    </>
  );
}

const WEEKDAY_NAMES = ["", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

function OccupancySection({ report, period }: { report: ClassReport; period: Period }) {
  return (
    <>
      <h2 className="sr-only">Okupansi</h2>
      <ReportTable
        title="Keterisian per jenis kelas"
        description="Kursi terisi (terdaftar, hadir, atau tidak hadir) dibagi kapasitas, dirata-rata per sesi."
        rows={report.per_class_type}
        rowKey={(r) => r.id}
        csvName="okupansi-jenis-kelas"
        period={period}
        columns={[
          { label: "Jenis kelas", value: (r) => r.name },
          { label: "Sesi", value: (r) => r.sessions, numeric: true },
          { label: "Jam kelas", value: (r) => r.hours, render: (r) => formatNumber(r.hours, 1), numeric: true },
          { label: "Rata-rata terisi (%)", value: (r) => percent(r.avg_fill), render: (r) => pct(r.avg_fill), numeric: true },
        ]}
      />
      <OccupancyHeatmap cells={report.heatmap} timeZone={report.timezone} />
      <ReportTable
        title="Keterisian per slot waktu"
        rows={report.heatmap}
        rowKey={(r) => `${r.weekday}-${r.hour}`}
        csvName="okupansi-slot"
        period={period}
        columns={[
          { label: "Hari", value: (r) => WEEKDAY_NAMES[r.weekday] },
          { label: "Jam mulai", value: (r) => `${String(r.hour).padStart(2, "0")}.00` },
          { label: "Sesi", value: (r) => r.sessions, numeric: true },
          { label: "Rata-rata terisi (%)", value: (r) => percent(r.avg_fill), render: (r) => pct(r.avg_fill), numeric: true },
        ]}
      />
    </>
  );
}

const revenueColumns = (first: string, label: (r: RevenueGroup) => string): ReportColumn<RevenueGroup>[] => [
  { label: first, value: label },
  { label: "Transaksi", value: (r) => r.sales, numeric: true },
  { label: "Penjualan (Rp)", value: (r) => r.gross, render: (r) => formatRupiah(r.gross), numeric: true },
  { label: "Porsi (%)", value: (r) => percent(r.share), render: (r) => pct(r.share), numeric: true },
];

function RevenueSection({ report, period }: { report: RevenueReport; period: Period }) {
  const t = report.totals;
  return (
    <>
      <h2 className="sr-only">Pendapatan</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Pendapatan bersih" value={formatRupiah(t.net)} hint="Penjualan dikurangi refund" icon={<Banknote />} tone="ink" />
        <StatCard label="Penjualan paket & pass" value={formatRupiah(t.gross)} hint={`${formatNumber(t.sales)} transaksi lunas`} icon={<Banknote />} />
        <StatCard label="Refund" value={formatRupiah(t.refund_amount)} hint={`${formatNumber(t.refunds)} transaksi`} icon={<RotateCcw />} tone={t.refunds ? "warning" : "default"} />
      </div>
      <DailyBarChart
        title="Penjualan per hari"
        summary={`Grafik batang penjualan per hari, total ${formatRupiah(t.gross)}.`}
        data={report.per_day}
        dataKey="gross"
        name="Penjualan"
        money
      />
      <ReportTable
        title="Pendapatan per hari"
        rows={report.per_day}
        rowKey={(r) => r.day}
        csvName="pendapatan-harian"
        period={period}
        columns={[
          { label: "Tanggal", value: (r) => r.day, render: (r) => formatDate(r.day) },
          { label: "Transaksi", value: (r) => r.sales, numeric: true },
          { label: "Penjualan (Rp)", value: (r) => r.gross, render: (r) => formatRupiah(r.gross), numeric: true },
          { label: "Refund (Rp)", value: (r) => r.refund_amount, render: (r) => formatRupiah(r.refund_amount), numeric: true },
          { label: "Bersih (Rp)", value: (r) => r.net, render: (r) => formatRupiah(r.net), numeric: true },
        ]}
      />
      <ReportTable
        title="Per paket"
        rows={report.per_package}
        rowKey={(r) => r.key}
        csvName="pendapatan-paket"
        period={period}
        columns={revenueColumns("Paket", (r) => (r.kind ? `${r.name} (${KIND_LABELS[r.kind]})` : r.name))}
      />
      <ReportTable title="Per metode pembayaran" rows={report.per_method} rowKey={(r) => r.key} csvName="pendapatan-metode" period={period} columns={revenueColumns("Metode", (r) => methodLabel(r.key))} />
      <ReportTable title="Per cabang" rows={report.per_branch} rowKey={(r) => r.key || "tanpa-cabang"} csvName="pendapatan-cabang" period={period} columns={revenueColumns("Cabang", (r) => r.name)} />
    </>
  );
}

const memberCell = (r: { id: string; name: string | null }) => <MemberLink id={r.id} name={r.name ?? "Tanpa nama"} />;
const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));

function MembersSection({ report, period }: { report: MembersReport; period: Period }) {
  const within = (iso: string, days: number) => daysLeft(iso) <= days;
  const passes14 = report.expiring_passes.filter((r) => within(r.ends_at, 14)).length;
  const credits14 = report.expiring_credits.filter((r) => within(r.expires_at, 14)).length;
  return (
    <>
      <h2 className="sr-only">Member</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Member baru" value={formatNumber(report.new_members)} hint="Terdaftar di rentang ini, semua cabang" icon={<UserPlus />} />
        <StatCard label="Member aktif" value={formatNumber(report.active_members)} hint="Check-in minimal sekali" icon={<Users />} tone="ink" />
        <StatCard
          label="Churn"
          value={pct(report.churn_rate)}
          hint={`${formatNumber(report.churned_members)} dari ${formatNumber(report.previous_active_members)} member aktif periode sebelumnya`}
          icon={<UserMinus />}
          tone={report.churned_members ? "warning" : "default"}
        />
        <StatCard
          label="Akan berakhir 14 / 30 hari"
          value={`${formatNumber(passes14 + credits14)} / ${formatNumber(report.expiring_passes.length + report.expiring_credits.length)}`}
          hint="Pass dan kredit, dihitung dari hari ini"
          icon={<CalendarCheck />}
        />
      </div>
      <DailyBarChart
        title="Member baru per hari"
        summary={`Grafik batang member baru per hari, total ${formatNumber(report.new_members)}.`}
        data={report.new_per_day}
        dataKey="count"
        name="Member baru"
      />
      <ReportTable
        title="Pass berakhir dalam 30 hari"
        rows={report.expiring_passes}
        rowKey={(r) => `${r.id}-${r.ends_at}`}
        csvName="pass-berakhir"
        period={period}
        empty="Tidak ada pass yang berakhir dalam 30 hari."
        columns={[
          { label: "Member", value: (r) => r.name, render: memberCell },
          { label: "Nomor HP", value: (r) => r.phone },
          { label: "Pass", value: (r) => r.package_name },
          { label: "Berakhir", value: (r) => r.ends_at.slice(0, 10), render: (r) => formatDate(r.ends_at) },
          { label: "Sisa hari", value: (r) => daysLeft(r.ends_at), numeric: true },
        ]}
      />
      <ReportTable
        title="Kredit kedaluwarsa dalam 30 hari"
        rows={report.expiring_credits}
        rowKey={(r) => r.id}
        csvName="kredit-kedaluwarsa"
        period={period}
        empty="Tidak ada kredit yang kedaluwarsa dalam 30 hari."
        columns={[
          { label: "Member", value: (r) => r.name, render: memberCell },
          { label: "Nomor HP", value: (r) => r.phone },
          { label: "Kredit", value: (r) => r.credits, numeric: true },
          { label: "Kedaluwarsa pertama", value: (r) => r.expires_at.slice(0, 10), render: (r) => formatDate(r.expires_at) },
          { label: "Sisa hari", value: (r) => daysLeft(r.expires_at), numeric: true },
        ]}
      />
      <ReportTable
        title="Member churn"
        description="Datang di periode sebelumnya dengan panjang yang sama, tidak datang di rentang ini."
        rows={report.churned}
        rowKey={(r) => r.id}
        csvName="member-churn"
        period={period}
        empty="Tidak ada member churn."
        columns={[
          { label: "Member", value: (r) => r.name, render: memberCell },
          { label: "Nomor HP", value: (r) => r.phone },
          { label: "Kunjungan terakhir", value: (r) => r.last_visit, render: (r) => formatDateTime(r.last_visit) },
        ]}
      />
    </>
  );
}

function CoachSection({ report, period }: { report: ClassReport; period: Period }) {
  return (
    <>
      <h2 className="sr-only">Utilisasi coach</h2>
      <ReportTable
        title="Utilisasi coach"
        description="Sesi yang sudah berlangsung di rentang ini."
        rows={report.per_coach}
        rowKey={(r) => r.id || "tanpa-coach"}
        csvName="utilisasi-coach"
        period={period}
        columns={[
          { label: "Coach", value: (r) => r.name },
          { label: "Sesi diajar", value: (r) => r.sessions, numeric: true },
          { label: "Jam mengajar", value: (r) => r.hours, render: (r) => formatNumber(r.hours, 1), numeric: true },
          { label: "Rata-rata terisi (%)", value: (r) => percent(r.avg_fill), render: (r) => pct(r.avg_fill), numeric: true },
          { label: "Check-in", value: (r) => r.checked_in, numeric: true },
          { label: "Tidak hadir (%)", value: (r) => percent(r.no_show_rate), render: (r) => pct(r.no_show_rate), numeric: true },
        ]}
      />
    </>
  );
}
