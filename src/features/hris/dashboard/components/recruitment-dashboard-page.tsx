"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/pg/browser-client";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { useDashboardBrands, useDashboardData } from "../queries";
import { fetchDashboardCandidatesForExport } from "../api";

const SOURCE_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#203b32"];

export function RecruitmentDashboardPage() {
  const router = useRouter();
  const db = useMemo(() => createBrowserClient(), []);
  const { toasts, showToast: toast, removeToast: dismiss } = useToast();

  // Redirect purchasing users to /dashboard/purchasing
  useEffect(() => {
    const checkRole = async () => {
      const { data: { user } } = await db.auth.getUser();
      if (user) {
        const { data: profile } = await db.from("users").select("role").eq("id", user.id).single();
        if (profile?.role === "super_admin") {
          return;
        }
        if (profile?.role === "pos") {
          router.replace("/dashboard/pos/cashier-new");
        } else if (profile && ["purchasing_manager", "purchasing_staff", "purchasing_admin", "warehouse_staff", "qc_staff"].includes(profile.role)) {
          router.replace("/dashboard/purchasing");
        }
      }
    };
    checkRole();
  }, [router]);

  const [brandFilter, setBrandFilter] = useState("all");
  const [period, setPeriod] = useState("month"); // week, month, 3month, 6month

  const brandsQuery = useDashboardBrands();
  const dataQuery = useDashboardData(brandFilter, period);

  const brands = brandsQuery.data ?? [];
  const loading = dataQuery.isLoading;
  const summary = dataQuery.data?.summary ?? { thisMonth: 0, activePipeline: 0, talentPool: 0, openPositions: 0 };
  const weeklyApps = dataQuery.data?.weeklyApps ?? [];
  const sourceDist = dataQuery.data?.sourceDist ?? [];
  const pipelineFunnel = dataQuery.data?.pipelineFunnel ?? [];
  const needsAttention = dataQuery.data?.needsAttention ?? [];

  const fetchData = () => dataQuery.refetch();

  const exportCSV = async () => {
    try {
      const candidates = await fetchDashboardCandidatesForExport(brandFilter);

      const rows = [["Nama", "Posisi", "Brand", "Status", "Sumber", "Tanggal Lamar"]];
      candidates.forEach((c: any) => {
        rows.push([
          c.full_name || "",
          c.position_title || "",
          c.brand_name || "",
          c.status || "",
          c.source || "",
          c.created_at ? new Date(c.created_at).toLocaleDateString("id-ID") : "",
        ]);
      });
      const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "kandidat.csv"; a.click();
      URL.revokeObjectURL(url);
      toast("Export CSV berhasil");
    } catch (err) {
      toast("Gagal export CSV");
    }
  };

  const exportPDF = () => {
    const printContent = `
      <html><head><title>Laporan Rekrutmen</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { color: #1e40af; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #f3f4f6; }
        .summary { display: flex; gap: 20px; margin: 20px 0; }
        .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; flex: 1; }
        .card h3 { margin: 0; font-size: 12px; color: #6b7280; }
        .card p { margin: 4px 0 0; font-size: 24px; font-weight: bold; }
      </style></head><body>
      <h1>Laporan Rekrutmen - ${new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" })}</h1>
      <div class="summary">
        <div class="card"><h3>Kandidat Bulan Ini</h3><p>${summary.thisMonth}</p></div>
        <div class="card"><h3>Pipeline Aktif</h3><p>${summary.activePipeline}</p></div>
        <div class="card"><h3>Talent Pool</h3><p>${summary.talentPool}</p></div>
        <div class="card"><h3>Lowongan Terbuka</h3><p>${summary.openPositions}</p></div>
      </div>
      <h2>Pipeline Funnel</h2>
      <table>
        <tr><th>Stage</th><th>Jumlah</th></tr>
        ${pipelineFunnel.map(s => `<tr><td>${s.name}</td><td>${s.value}</td></tr>`).join("")}
      </table>
      <h2>Kandidat Butuh Perhatian</h2>
      <table>
        <tr><th>Nama</th><th>Posisi</th><th>Brand</th><th>Status</th><th>Lama di Status</th></tr>
        ${needsAttention.map((a: any) => {
          const days = a.days_in_current_status || 0;
          return `<tr><td>${a.full_name || ""}</td><td>${a.position_title || ""}</td><td>${a.brand_name || ""}</td><td>${a.status}</td><td>${days} hari</td></tr>`;
        }).join("")}
      </table>
      </body></html>
    `;
    const w = window.open("", "_blank");
    if (w) { w.document.write(printContent); w.document.close(); w.print(); }
    toast("PDF siap di print");
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
            {brands.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
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
        <Button variant="outline" onClick={fetchData} className="text-sm">Refresh</Button>
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
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                  <UserGroupIcon className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Kandidat Bulan Ini</p>
                  <p className="text-2xl font-bold text-gray-900">{summary.thisMonth}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <ChartBarIcon className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Pipeline Aktif</p>
                  <p className="text-2xl font-bold text-gray-900">{summary.activePipeline}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                  <TrophyIcon className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Talent Pool</p>
                  <p className="text-2xl font-bold text-gray-900">{summary.talentPool}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                  <BriefcaseIcon className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Lowongan Terbuka</p>
                  <p className="text-2xl font-bold text-gray-900">{summary.openPositions}</p>
                </div>
              </div>
            </CardContent>
          </Card>
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
                  <Line type="monotone" dataKey="candidates" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} name="Kandidat" />
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
                  <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} name="Jumlah" />
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
                {needsAttention.map((a: any) => {
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

      <ToastContainer toasts={toasts} removeToast={dismiss} />
    </div>
  );
}

function Button({ variant, onClick, className, children, ...props }: any) {
  const base = "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus:outline-none disabled:opacity-50 px-3 py-1.5";
  const variants: Record<string, string> = {
    outline: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
    ghost: "text-gray-600 hover:bg-gray-100",
  };
  return <button className={`${base} ${variants[variant || "outline"]} ${className || ""}`} onClick={onClick} {...props}>{children}</button>;
}
