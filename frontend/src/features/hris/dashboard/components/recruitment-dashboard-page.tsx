"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  UserGroupIcon,
  BriefcaseIcon,
  TrophyIcon,
  ClockIcon,
  ChartBarIcon,
  DocumentArrowDownIcon,
} from "@heroicons/react/24/outline";
import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useAuth } from "@/hooks/use-auth";
import { downloadCSV } from "@/lib/utils/csv-export";
import { recruitmentDashboardCsv } from "@/lib/recruitment/candidate-csv";
import { fetchAllCandidates } from "../../candidates/api";
import { useDashboardBrands, useDashboardData } from "../queries";
import { buildRecruitmentReportHtml } from "../recruitment-report";
import type { DashboardSummary } from "../types";

const SOURCE_COLORS = ["#00281a", "#abde67", "#c9a227", "#1c261b", "#daff59", "#203b32", "#eeffb1"];
const PURCHASING_ROLES = ["purchasing_manager", "purchasing_staff", "purchasing_admin", "warehouse_staff", "qc_staff"];
const EMPTY_SUMMARY: DashboardSummary = { thisMonth: 0, activePipeline: 0, talentPool: 0, openPositions: 0 };

const SUMMARY_CARDS = [
  { key: "thisMonth", label: "Kandidat Bulan Ini", Icon: UserGroupIcon, tint: "bg-blue-100", ink: "text-blue-600" },
  { key: "activePipeline", label: "Pipeline Aktif", Icon: ChartBarIcon, tint: "bg-indigo-100", ink: "text-indigo-600" },
  { key: "talentPool", label: "Talent Pool", Icon: TrophyIcon, tint: "bg-green-100", ink: "text-green-600" },
  { key: "openPositions", label: "Lowongan Terbuka", Icon: BriefcaseIcon, tint: "bg-amber-100", ink: "text-amber-600" },
] as const;

export function RecruitmentDashboardPage() {
  const router = useRouter();
  const { user } = useAuth();

  // user POS & purchasing punya beranda sendiri
  useEffect(() => {
    if (!user || user.role === "super_admin") return;
    if (user.role === "pos") router.replace("/dashboard/pos/cashier-new");
    else if (PURCHASING_ROLES.includes(user.role)) router.replace("/dashboard/purchasing");
  }, [user, router]);

  const [brandFilter, setBrandFilter] = useState("all");
  const [period, setPeriod] = useState("month"); // week, month, 3month, 6month

  const brandsQuery = useDashboardBrands();
  const dataQuery = useDashboardData(brandFilter, period);

  const brands = brandsQuery.data ?? [];
  const loading = dataQuery.isLoading;
  const summary = dataQuery.data?.summary ?? EMPTY_SUMMARY;
  const weeklyApps = dataQuery.data?.weeklyApps ?? [];
  const sourceDist = dataQuery.data?.sourceDist ?? [];
  const pipelineFunnel = dataQuery.data?.pipelineFunnel ?? [];
  const needsAttention = dataQuery.data?.needsAttention ?? [];

  const exportCSV = async () => {
    try {
      const candidates = await fetchAllCandidates({ brand_id: brandFilter === "all" ? undefined : brandFilter });
      downloadCSV(recruitmentDashboardCsv(candidates), "kandidat.csv");
      toast.success("Export CSV berhasil");
    } catch {
      toast.error("Gagal export CSV");
    }
  };

  const exportPDF = () => {
    const printContent = buildRecruitmentReportHtml({
      periodLabel: new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "Asia/Jakarta" }),
      summary,
      pipelineFunnel,
      needsAttention,
    });
    const w = window.open("", "_blank");
    if (w) { w.document.write(printContent); w.document.close(); w.print(); }
    toast.success("PDF siap di print");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Ringkasan proses rekrutmen</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCSV} className="gap-2 text-sm">
            <DocumentArrowDownIcon className="w-4 h-4" /> CSV
          </Button>
          <Button variant="outline" onClick={exportPDF} className="gap-2 text-sm">
            <DocumentArrowDownIcon className="w-4 h-4" /> PDF
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Select value={brandFilter} onValueChange={(v) => setBrandFilter(v ?? "all")}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Semua Outlet" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Outlet</SelectItem>
            {brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={period} onValueChange={(v) => setPeriod(v ?? "month")}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="week">Minggu Ini</SelectItem>
            <SelectItem value="month">Bulan Ini</SelectItem>
            <SelectItem value="3month">3 Bulan</SelectItem>
            <SelectItem value="6month">6 Bulan</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => dataQuery.refetch()} className="text-sm">Refresh</Button>
      </div>

      {/* Summary Cards */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse"><CardContent className="pt-6"><div className="h-16 bg-gray-100 rounded" /></CardContent></Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {SUMMARY_CARDS.map(({ key, label, Icon, tint, ink }) => (
            <Card key={key}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg ${tint} flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 ${ink}`} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className="text-2xl font-bold text-gray-900">{summary[key]}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weekly Applications Line Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">Kandidat Masuk Per Minggu</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-48 bg-gray-50 rounded animate-pulse" />
            ) : weeklyApps.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Belum ada data</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={weeklyApps}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="candidates" stroke="#00281a" strokeWidth={2} dot={{ r: 3 }} name="Kandidat" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Source Distribution Pie Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">Distribusi Sumber Kandidat</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-48 bg-gray-50 rounded animate-pulse" />
            ) : sourceDist.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Belum ada data</div>
            ) : (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="60%" height={200}>
                  <PieChart>
                    <Pie data={sourceDist} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                      {sourceDist.map((_, i) => (
                        <Cell key={i} fill={SOURCE_COLORS[i % SOURCE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1">
                  {sourceDist.map((s, i) => (
                    <div key={s.name} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
                      <span className="text-gray-600 truncate">{s.name}</span>
                      <span className="ml-auto font-medium text-gray-900">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pipeline Funnel */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">Pipeline Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-48 bg-gray-50 rounded animate-pulse" />
            ) : pipelineFunnel.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Belum ada data</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={pipelineFunnel} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#00281a" radius={[0, 4, 4, 0]} name="Jumlah" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Needs Attention */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <ClockIcon className="w-4 h-4 text-amber-500" />
              Butuh Perhatian
              <Badge className="bg-amber-100 text-amber-700 text-xs">Terlama di status</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2"><div className="h-8 bg-gray-50 rounded animate-pulse" /><div className="h-8 bg-gray-50 rounded animate-pulse" /><div className="h-8 bg-gray-50 rounded animate-pulse" /></div>
            ) : needsAttention.length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-sm">Semua kandidat berjalan lancar</div>
            ) : (
              <div className="space-y-2">
                {needsAttention.map((a) => {
                  const days = a.days_in_current_status || 0;
                  return (
                    <div key={a.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{a.full_name}</p>
                        <p className="text-xs text-gray-400 truncate">{a.position_title} · {a.brand_name}</p>
                      </div>
                      <div className="flex items-center gap-2 ml-2">
                        <Badge className="text-xs">{a.status}</Badge>
                        <span className={`text-xs font-medium ${days > 14 ? "text-red-500" : days > 7 ? "text-amber-500" : "text-gray-400"}`}>
                          {days}d
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
