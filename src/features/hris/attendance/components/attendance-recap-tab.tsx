"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AttendanceCalendar } from "@/components/hris/AttendanceCalendar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Clock, Download } from "lucide-react";
import { formatDate, formatTime } from "@/lib/format";
import { currentMonthWib, monthRange } from "@/lib/hris/attendance-calendar";
import { SelfiePhotoDialog } from "./selfie-photo-dialog";
import { exportAttendanceCsv, type AttendanceExportFormat } from "../api";
import { useActiveEmployees, useAttendanceList, useAttendanceMonthStats } from "../queries";

/**
 * Tab "Rekap" absensi HRD: tabel absensi berpagination dengan filter
 * karyawan/bulan/keterlambatan + export CSV. Saat satu karyawan dipilih,
 * kalender bulanan per-karyawan ikut ditampilkan.
 */

const PAGE_LIMIT = 20;

export function AttendanceRecapTab() {
  const [filterEmployee, setFilterEmployee] = useState("all");
  const [month, setMonth] = useState(() => currentMonthWib());
  const [lateOnly, setLateOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState<AttendanceExportFormat | null>(null);

  const employees = useActiveEmployees().data;
  const stats = useAttendanceMonthStats(month).data ?? null;
  const range = useMemo(() => monthRange(month), [month]);
  const listQuery = useAttendanceList({
    employee_id: filterEmployee === "all" ? undefined : filterEmployee,
    start_date: range.start,
    end_date: range.end,
    is_late: lateOnly || undefined,
    page,
    limit: PAGE_LIMIT,
  });
  const rows = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination.total ?? 0;
  const totalPages = Math.max(1, listQuery.data?.pagination.totalPages ?? 1);
  const loading = listQuery.isLoading;
  const error = listQuery.error ? listQuery.error.message || "Gagal memuat data absensi" : null;

  // Filter berubah → kembali ke halaman 1.
  const changeFilter = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  // Permintaan owner 2026-08-28: HR kesulitan membaca CSV — sediakan juga
  // Excel yang rapi dan PDF ber-foto selfie. Ketiganya mengikuti filter
  // karyawan + periode (bulan) yang sedang dipilih di halaman ini.
  async function handleExport(format: AttendanceExportFormat) {
    setExporting(format);
    try {
      const blob = await exportAttendanceCsv(
        {
          employee_id: filterEmployee,
          start_date: range.start,
          end_date: range.end,
        },
        format
      );
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rekap-absensi_${month}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      toast.error("Export gagal: " + (err instanceof Error ? err.message : "unknown"));
    } finally {
      setExporting(null);
    }
  }

  const employeeOptions = useMemo(
    () => [
      { value: "all", label: "Semua Karyawan" },
      ...(employees ?? []).map((emp) => ({
        value: emp.id,
        label: emp.nip ? `${emp.full_name} (${emp.nip})` : emp.full_name,
      })),
    ],
    [employees]
  );

  return (
    <div className="space-y-4">
      {/* Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Karyawan</label>
              <Combobox
                options={employeeOptions}
                value={filterEmployee}
                onChange={changeFilter(setFilterEmployee)}
                placeholder="Semua karyawan"
                searchPlaceholder="Cari nama/NIP…"
                emptyMessage="Karyawan tidak ditemukan"
                className="!w-full h-9 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Bulan</label>
              <Input type="month" value={month} onChange={(e) => changeFilter(setMonth)(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Keterlambatan
              </label>
              <Select
                value={lateOnly ? "late" : "all"}
                onValueChange={(value) => changeFilter(setLateOnly)(value === "late")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Rekaman</SelectItem>
                  <SelectItem value="late">Hanya Terlambat</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <div className="flex w-full gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => handleExport("xlsx")}
                  disabled={exporting !== null}
                  title="Unduh rekap sebagai Excel yang rapi"
                >
                  <Download className="w-4 h-4 mr-1.5" />
                  {exporting === "xlsx" ? "Mengekspor…" : "Excel"}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => handleExport("pdf")}
                  disabled={exporting !== null}
                  title="Unduh rekap sebagai PDF berikut foto selfie"
                >
                  <Download className="w-4 h-4 mr-1.5" />
                  {exporting === "pdf" ? "Mengekspor…" : "PDF + Foto"}
                </Button>
                <Button
                  variant="ghost"
                  className="flex-none px-3"
                  onClick={() => handleExport("csv")}
                  disabled={exporting !== null}
                  title="Unduh data mentah CSV"
                >
                  {exporting === "csv" ? "…" : "CSV"}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Statistik bulan terpilih */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Rekaman Absensi", value: stats ? String(stats.month_records) : "…" },
          { label: "Terlambat", value: stats ? String(stats.month_late) : "…" },
          { label: "Di Luar Jadwal", value: stats ? String(stats.month_off_schedule) : "…" },
          {
            label: "Rata-rata Jam Kerja",
            value: stats ? (stats.avg_work_hours != null ? `${stats.avg_work_hours} jam` : "—") : "…",
          },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="pt-4 pb-3">
              <p className="text-2xl font-bold text-gray-900">{item.value}</p>
              <p className="text-xs text-gray-500">{item.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Kalender per-karyawan (hanya saat satu karyawan dipilih) */}
      {filterEmployee !== "all" && (
        <AttendanceCalendar employeeId={filterEmployee} />
      )}

      {/* Tabel */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full" />
            </div>
          ) : error ? (
            <div className="py-12 text-center text-sm text-red-500">{error}</div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <Clock className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              Tidak ada rekaman absensi untuk filter ini.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-gray-600">
                    <th className="p-3">Tanggal</th>
                    <th className="p-3">Karyawan</th>
                    <th className="p-3">Shift</th>
                    <th className="p-3">Masuk</th>
                    <th className="p-3">Pulang</th>
                    <th className="p-3">Jam Kerja</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Selfie</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-gray-50">
                      <td className="p-3 whitespace-nowrap text-gray-700">
                        {formatDate(row.date)}
                      </td>
                      <td className="p-3">
                        <p className="font-medium text-gray-900">
                          {row.employee?.full_name ?? "—"}
                        </p>
                        {row.employee?.nip && (
                          <p className="text-xs text-gray-400">{row.employee.nip}</p>
                        )}
                      </td>
                      <td className="p-3 text-gray-600">
                        {row.shift?.name ?? (
                          <span className="text-orange-600 text-xs">Di luar jadwal</span>
                        )}
                      </td>
                      <td className="p-3 text-gray-600">{formatTime(row.clock_in, "—")}</td>
                      <td className="p-3 text-gray-600">{formatTime(row.clock_out, "—")}</td>
                      <td className="p-3 text-gray-600">
                        {row.work_hours != null ? `${Number(row.work_hours).toFixed(1)} jam` : "—"}
                      </td>
                      <td className="p-3">
                        {row.is_late ? (
                          <Badge className="bg-yellow-100 text-yellow-700">
                            Terlambat +{row.late_minutes} mnt
                          </Badge>
                        ) : (
                          <Badge className="bg-green-100 text-green-700">Hadir</Badge>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          <SelfiePhotoDialog
                            path={row.clock_in_photo_url}
                            label="masuk"
                            employeeName={row.employee?.full_name ?? null}
                            time={formatTime(row.clock_in, "—")}
                          />
                          <SelfiePhotoDialog
                            path={row.clock_out_photo_url}
                            label="pulang"
                            employeeName={row.employee?.full_name ?? null}
                            time={formatTime(row.clock_out, "—")}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {!loading && !error && total > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            {total} rekaman · halaman {page} dari {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Sebelumnya
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Berikutnya
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
