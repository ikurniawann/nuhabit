"use client";

import { useState } from "react";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  DocumentArrowDownIcon,
  UsersIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
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
  ReferenceLine,
} from "recharts";
import { useAnalyticsBrands, useAnalyticsData } from "../queries";


const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#203b32", "#14b8a6"];

export function AnalyticsPage() {
  const { toasts, showToast, removeToast } = useToast();
  const [brandFilter, setBrandFilter] = useState("all");
  const [period, setPeriod] = useState("month");

  const brandsQuery = useAnalyticsBrands();
  const dataQuery = useAnalyticsData(brandFilter, period);

  const brands = brandsQuery.data ?? [];
  const loading = dataQuery.isLoading;
  const timeToHire = dataQuery.data?.timeToHire ?? null;
  const conversionRates = dataQuery.data?.conversionRates ?? [];
  const topSources = dataQuery.data?.topSources ?? [];
  const hardToFill = dataQuery.data?.hardToFill ?? [];
  const brandComparison = dataQuery.data?.brandComparison ?? [];
  const monthlyTrend = dataQuery.data?.monthlyTrend ?? [];
  const hiredByBrand = dataQuery.data?.hiredByBrand ?? [];

  const fetchData = () => dataQuery.refetch();

  const exportCSV = () => {
    const rows = [["Metrik", "Nilai"]];
    if (timeToHire) rows.push(["Rata-rata Time to Hire (hari)", timeToHire.avgDays]);
    rows.push(["\nSumber Kandidat"]);
    topSources.forEach(s => rows.push([s.source || s.name, `${s.hired} hired / ${s.total} applied (${s.rate}%)`]));
    rows.push(["\nPosisi Sulit Diisi"]);
    hardToFill.forEach(h => rows.push([h.position_title || h.title, `${h.count} kandidat di pipeline`]));
    rows.push(["\nPerbandingan Brand"]);
    brandComparison.forEach(b => rows.push([b.brand || b.name, `Applied: ${b.applicants || b.applied}, Hired: ${b.hired}, Active: ${b.active}`]));
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "laporan-analytics.csv"; a.click();
    URL.revokeObjectURL(url);
    showToast("Export CSV berhasil");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-gray-500 text-sm mt-1">Analisis mendalam proses rekrutmen</p>
        </div>
        <Button variant="outline" onClick={exportCSV} className="gap-2 text-sm">
          <DocumentArrowDownIcon className="w-4 h-4" /> Export CSV
        </Button>
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
        <Button variant="outline" onClick={fetchData}>Refresh</Button>
      </div>

      {/* KPI Row */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <ClockIcon className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Time to Hire</p>
                  <p className="text-2xl font-bold">{timeToHire?.avgDays || 0} <span className="text-sm font-normal text-gray-400">hari</span></p>
                  <p className="text-xs text-gray-400">{timeToHire?.count || 0} kandidat hired</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                  <CheckCircleIcon className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Hiring Rate</p>
                  <p className="text-2xl font-bold">
                    {conversionRates.length > 0 ? conversionRates[conversionRates.length - 1].rate : 0}%
                  </p>
                  <p className="text-xs text-gray-400">Talent Pool → Hired</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                  <UsersIcon className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Total Sources</p>
                  <p className="text-2xl font-bold">
                    {(topSources.filter(s => s.source && s.source !== "").length) || 0}
                  </p>
                  <p className="text-xs text-gray-400">portal aktif</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
                  <XCircleIcon className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Sulit Diisi</p>
                  <p className="text-2xl font-bold">{hardToFill.length || 0}</p>
                  <p className="text-xs text-gray-400">posisi lama</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Trend */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">Trend Bulanan: Applied vs Hired</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <SkeletonChart /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="applied" fill="#6366f1" radius={[4, 4, 0, 0]} name="Dilamar" />
                  <Bar dataKey="hired" fill="#22c55e" radius={[4, 4, 0, 0]} name="Dihire" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Conversion Rates */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">Conversion Rate per Tahapan</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <SkeletonChart /> : conversionRates.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Belum ada data</div>
            ) : (
              <div className="space-y-3">
                {conversionRates.map((c) => (
                  <div key={c.stage}>
                    <div className="flex justify-between text-xs text-gray-600 mb-1">
                      <span>{c.stage}</span>
                      <span className="font-medium">{c.rate}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className="h-2 rounded-full transition-all duration-500"
                        style={{ width: `${c.rate}%`, backgroundColor: c.rate > 50 ? "#22c55e" : c.rate > 25 ? "#f59e0b" : "#ef4444" }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Sources */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">Sumber Kandidat Terbaik</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <SkeletonChart /> : topSources.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Belum ada data</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={topSources} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="source" tick={{ fontSize: 11 }} width={80} />
                  <Tooltip />
                  <Bar dataKey="hired" fill="#22c55e" radius={[0, 4, 4, 0]} name="Hired" />
                  <Bar dataKey="total" fill="#e5e7eb" radius={[0, 4, 4, 0]} name="Total" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Hard to Fill Positions */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <ArrowTrendingDownIcon className="w-4 h-4 text-red-500" />
              Posisi Paling Lama di Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <SkeletonChart /> : hardToFill.length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-sm">Semua posisi terisi dengan baik</div>
            ) : (
              <div className="space-y-2">
                {hardToFill.map((h, i) => (
                  <div key={h.position_title} className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-gray-300">#{i + 1}</span>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{h.position_title}</p>
                        <p className="text-xs text-gray-400">{h.count} kandidat di pipeline</p>
                      </div>
                    </div>
                    <Badge className={`text-xs ${h.count > 5 ? "bg-red-100 text-red-700" : h.count > 2 ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
                      {h.count} kandidat
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Brand Comparison */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">Perbandingan Brand / Outlet</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <SkeletonChart /> : brandComparison.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Belum ada data</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={brandComparison}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="brand" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="applicants" fill="#6366f1" radius={[4, 4, 0, 0]} name="Dilamar" />
                  <Bar dataKey="active" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Pipeline" />
                  <Bar dataKey="hired" fill="#22c55e" radius={[4, 4, 0, 0]} name="Hired" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Hired by Brand Pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">Distribusi Hire per Brand</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <SkeletonChart /> : hiredByBrand.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Belum ada data</div>
            ) : (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="55%" height={180}>
                  <PieChart>
                    <Pie data={hiredByBrand} cx="50%" cy="50%" outerRadius={75} dataKey="value" label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                      {hiredByBrand.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1">
                  {hiredByBrand.map((s, i) => (
                    <div key={s.name} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-gray-600 truncate">{s.name}</span>
                      <span className="ml-auto font-medium">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}

function SkeletonCard() {
  return <Card><CardContent className="pt-6"><div className="h-20 bg-gray-100 rounded animate-pulse" /></CardContent></Card>;
}

function SkeletonChart() {
  return <div className="h-48 bg-gray-50 rounded animate-pulse" />;
}

function Button({ variant, onClick, className, children, ...props }: any) {
  const base = "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus:outline-none disabled:opacity-50 px-3 py-1.5";
  const variants: Record<string, string> = {
    outline: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
  };
  return <button className={`${base} ${variants[variant || "outline"]} ${className || ""}`} onClick={onClick} {...props}>{children}</button>;
}
