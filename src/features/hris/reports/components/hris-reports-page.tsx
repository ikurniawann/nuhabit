"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  UsersIcon,
  ClockIcon,
  CalendarDaysIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  DocumentArrowDownIcon,
  UserPlusIcon,
  UserMinusIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useHRISReport } from "../queries";

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#2941d3", "#14b8a6", "#f97316"];

const STATUS_LABELS: Record<string, string> = {
  permanent: "Tetap",
  contract: "Kontrak",
  probation: "Probasi",
  internship: "Magang",
  resigned: "Resign",
  terminated: "PHK",
  suspended: "Suspend",
};

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function StatCard({
  title, value, sub, icon, color = "blue", trend,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  color?: "blue" | "green" | "yellow" | "red" | "purple";
  trend?: { value: number; label: string };
}) {
  const colors = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-green-50 text-green-600",
    yellow: "bg-yellow-50 text-yellow-600",
    red: "bg-red-50 text-red-600",
    purple: "bg-purple-50 text-purple-600",
  };
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{title}</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
            {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
            {trend && (
              <div className={`flex items-center gap-1 mt-1 text-xs font-medium ${trend.value >= 0 ? "text-green-600" : "text-red-600"}`}>
                {trend.value >= 0
                  ? <ArrowTrendingUpIcon className="w-3.5 h-3.5" />
                  : <ArrowTrendingDownIcon className="w-3.5 h-3.5" />
                }
                {Math.abs(trend.value)}% {trend.label}
              </div>
            )}
          </div>
          <div className={`p-2.5 rounded-xl ${colors[color]}`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// CSV export helper
function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const lines = [
    headers.join(","),
    ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")),
  ];
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function HRISReportsPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const reportQuery = useHRISReport(month, year);
  const data = reportQuery.data ?? null;
  const loading = reportQuery.isLoading;

  // Export headcount by department as CSV
  function exportHeadcount() {
    if (!data) return;
    downloadCSV(
      `laporan-headcount-${year}-${String(month).padStart(2, "0")}.csv`,
      ["Departemen", "Jumlah Karyawan"],
      data.headcount.by_department.map((d: any) => [d.name, d.count])
    );
  }

  // Export attendance summary as CSV
  function exportAttendance() {
    if (!data) return;
    const a = data.attendance;
    downloadCSV(
      `laporan-absensi-${year}-${String(month).padStart(2, "0")}.csv`,
      ["Metrik", "Nilai"],
      [
        ["Total Catatan", a.total_records],
        ["Hadir", a.present_count],
        ["Tidak Hadir", a.absent_count],
        ["Terlambat", a.late_count],
        ["Tingkat Kehadiran (%)", a.present_rate],
        ["Tingkat Keterlambatan (%)", a.late_rate],
        ["Rata-rata Jam Kerja", a.avg_work_hours],
      ]
    );
  }

  // Export leave summary as CSV
  function exportLeaves() {
    if (!data) return;
    downloadCSV(
      `laporan-cuti-${year}-${String(month).padStart(2, "0")}.csv`,
      ["Jenis Cuti", "Total Hari"],
      data.leaves.by_type.map((l: any) => [l.type, l.days])
    );
  }

  // Export full report as CSV
  function exportFull() {
    if (!data) return;
    const h = data.headcount;
    const a = data.attendance;
    const l = data.leaves;
    const rows: (string | number)[][] = [
      ["=== RINGKASAN HEADCOUNT ===", ""],
      ["Total Karyawan Aktif", h.total_active],
      ["Karyawan Baru Bulan Ini", h.new_hires],
      ["Turnover Tahun Ini", h.turnover_count],
      ["Tingkat Turnover (%)", h.turnover_rate],
      ["", ""],
      ["=== KOMPOSISI STATUS ===", ""],
      ...h.by_status.map((s: any) => [STATUS_LABELS[s.status] || s.status, s.count]),
      ["", ""],
      ["=== HEADCOUNT PER DEPARTEMEN ===", ""],
      ...h.by_department.map((d: any) => [d.name, d.count]),
      ["", ""],
      ["=== STATISTIK ABSENSI ===", ""],
      ["Tingkat Kehadiran (%)", a.present_rate],
      ["Tingkat Keterlambatan (%)", a.late_rate],
      ["Rata-rata Jam Kerja", a.avg_work_hours],
      ["Total Tidak Hadir", a.absent_count],
      ["", ""],
      ["=== RINGKASAN CUTI ===", ""],
      ["Total Pengajuan Disetujui", l.approved_count],
      ["Total Hari Cuti", l.total_days],
      ["Menunggu Persetujuan", l.pending_count],
    ];
    downloadCSV(
      `laporan-hris-lengkap-${year}-${String(month).padStart(2, "0")}.csv`,
      ["Keterangan", "Nilai"],
      rows
    );
  }

  const years = Array.from({ length: 4 }, (_, i) => now.getFullYear() - i);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Laporan HRIS</h1>
          <p className="text-sm text-gray-500 mt-1">
            {MONTHS[month - 1]} {year}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Period filter */}
          <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v))}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Export buttons */}
          <Button variant="outline" size="sm" onClick={exportFull} disabled={!data} className="gap-1.5">
            <DocumentArrowDownIcon className="w-4 h-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-2 border-gray-300 border-t-blue-500 rounded-full" />
        </div>
      ) : !data ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            Gagal memuat data laporan
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── HEADCOUNT KPIs ── */}
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
              <UsersIcon className="w-4 h-4" /> Headcount
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title="Total Aktif"
                value={data.headcount.total_active}
                sub="karyawan aktif"
                icon={<UsersIcon className="w-5 h-5" />}
                color="blue"
              />
              <StatCard
                title="Karyawan Baru"
                value={data.headcount.new_hires}
                sub={`bergabung ${MONTHS[month - 1]}`}
                icon={<UserPlusIcon className="w-5 h-5" />}
                color="green"
              />
              <StatCard
                title="Turnover YTD"
                value={data.headcount.turnover_count}
                sub="resign/PHK tahun ini"
                icon={<UserMinusIcon className="w-5 h-5" />}
                color="red"
              />
              <StatCard
                title="Turnover Rate"
                value={`${data.headcount.turnover_rate}%`}
                sub="tahun berjalan"
                icon={<ArrowTrendingDownIcon className="w-5 h-5" />}
                color={data.headcount.turnover_rate > 10 ? "red" : "yellow"}
              />
            </div>
          </div>

          {/* ── HEADCOUNT CHARTS ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* By Status Pie */}
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold text-gray-700">Komposisi Status Karyawan</CardTitle>
              </CardHeader>
              <CardContent>
                {data.headcount.by_status.length === 0 ? (
                  <p className="text-center text-gray-400 py-8 text-sm">Tidak ada data</p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={data.headcount.by_status.map((s: any) => ({
                          name: STATUS_LABELS[s.status] || s.status,
                          value: s.count,
                        }))}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {data.headcount.by_status.map((_: any, i: number) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: any) => [`${v} orang`, ""]} />
                      <Legend iconType="circle" iconSize={8} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* By Department Bar */}
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold text-gray-700">Headcount per Departemen</CardTitle>
                <Button variant="ghost" size="sm" onClick={exportHeadcount} className="text-xs gap-1 h-7">
                  <DocumentArrowDownIcon className="w-3.5 h-3.5" /> CSV
                </Button>
              </CardHeader>
              <CardContent>
                {data.headcount.by_department.length === 0 ? (
                  <p className="text-center text-gray-400 py-8 text-sm">Tidak ada data departemen</p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.headcount.by_department} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                      <Tooltip formatter={(v: any) => [`${v} orang`, "Karyawan"]} />
                      <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── 6-MONTH TREND ── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-gray-700">Tren Headcount 6 Bulan</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data.headcount.monthly_trend} margin={{ left: 0, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => [`${v} orang`, "Headcount"]} />
                  <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* ── ATTENDANCE KPIs ── */}
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
              <ClockIcon className="w-4 h-4" /> Absensi — {MONTHS[month - 1]} {year}
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title="Tingkat Kehadiran"
                value={`${data.attendance.present_rate}%`}
                sub={`${data.attendance.present_count} dari ${data.attendance.total_records} hari`}
                icon={<CheckCircleIcon className="w-5 h-5" />}
                color={data.attendance.present_rate >= 90 ? "green" : "yellow"}
              />
              <StatCard
                title="Tingkat Keterlambatan"
                value={`${data.attendance.late_rate}%`}
                sub={`${data.attendance.late_count} kali terlambat`}
                icon={<ExclamationTriangleIcon className="w-5 h-5" />}
                color={data.attendance.late_rate > 15 ? "red" : "yellow"}
              />
              <StatCard
                title="Total Tidak Hadir"
                value={data.attendance.absent_count}
                sub="hari absen"
                icon={<ClockIcon className="w-5 h-5" />}
                color="red"
              />
              <StatCard
                title="Rata-rata Jam Kerja"
                value={`${data.attendance.avg_work_hours}j`}
                sub="per hari kerja"
                icon={<ClockIcon className="w-5 h-5" />}
                color="blue"
              />
            </div>
          </div>

          {/* ── DAILY ATTENDANCE TREND ── */}
          {data.attendance.daily_trend.length > 0 && (
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold text-gray-700">Tren Harian Absensi</CardTitle>
                <Button variant="ghost" size="sm" onClick={exportAttendance} className="text-xs gap-1 h-7">
                  <DocumentArrowDownIcon className="w-3.5 h-3.5" /> CSV
                </Button>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.attendance.daily_trend} margin={{ left: 0, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={3} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend iconType="circle" iconSize={8} />
                    <Bar dataKey="present" name="Hadir" fill="#22c55e" stackId="a" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="late" name="Terlambat" fill="#f59e0b" stackId="b" />
                    <Bar dataKey="absent" name="Absen" fill="#ef4444" stackId="c" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* ── LEAVE KPIs ── */}
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
              <CalendarDaysIcon className="w-4 h-4" /> Cuti & Izin — {MONTHS[month - 1]} {year}
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <StatCard
                title="Disetujui"
                value={data.leaves.approved_count}
                sub="pengajuan cuti"
                icon={<CheckCircleIcon className="w-5 h-5" />}
                color="green"
              />
              <StatCard
                title="Total Hari Cuti"
                value={data.leaves.total_days}
                sub="hari kerja digunakan"
                icon={<CalendarDaysIcon className="w-5 h-5" />}
                color="purple"
              />
              <StatCard
                title="Menunggu Approval"
                value={data.leaves.pending_count}
                sub="pengajuan pending"
                icon={<ExclamationTriangleIcon className="w-5 h-5" />}
                color={data.leaves.pending_count > 5 ? "yellow" : "blue"}
              />
            </div>
          </div>

          {/* ── LEAVE BY TYPE ── */}
          {data.leaves.by_type.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-gray-700">Cuti per Jenis (Hari)</CardTitle>
                  <Button variant="ghost" size="sm" onClick={exportLeaves} className="text-xs gap-1 h-7">
                    <DocumentArrowDownIcon className="w-3.5 h-3.5" /> CSV
                  </Button>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.leaves.by_type} margin={{ left: 0, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="type" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: any) => [`${v} hari`, ""]} />
                      <Bar dataKey="days" name="Hari" fill="#8b5cf6" radius={[4, 4, 0, 0]}>
                        {data.leaves.by_type.map((_: any, i: number) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Leave type breakdown list */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-gray-700">Detail per Jenis</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {data.leaves.by_type.map((l: any, i: number) => (
                      <div key={l.type} className="flex items-center gap-3">
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: COLORS[i % COLORS.length] }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-700">{l.type}</span>
                            <span className="font-semibold text-gray-900">{l.days} hari</span>
                          </div>
                          <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(l.days / data.leaves.total_days) * 100}%`,
                                backgroundColor: COLORS[i % COLORS.length],
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── TURNOVER TABLE ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <ArrowTrendingDownIcon className="w-4 h-4 text-red-500" />
                Ringkasan Turnover
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-2xl font-bold text-gray-900">{data.headcount.total_active}</p>
                  <p className="text-xs text-gray-500 mt-1">Karyawan Aktif Saat Ini</p>
                </div>
                <div className="bg-red-50 rounded-xl p-4">
                  <p className="text-2xl font-bold text-red-700">{data.headcount.turnover_count}</p>
                  <p className="text-xs text-gray-500 mt-1">Keluar Tahun {year}</p>
                </div>
                <div className={`rounded-xl p-4 ${data.headcount.turnover_rate > 10 ? "bg-red-50" : "bg-green-50"}`}>
                  <p className={`text-2xl font-bold ${data.headcount.turnover_rate > 10 ? "text-red-700" : "text-green-700"}`}>
                    {data.headcount.turnover_rate}%
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Turnover Rate</p>
                  <Badge className={`mt-1 text-xs ${data.headcount.turnover_rate > 10 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                    {data.headcount.turnover_rate > 10 ? "Di atas normal" : "Normal"}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
