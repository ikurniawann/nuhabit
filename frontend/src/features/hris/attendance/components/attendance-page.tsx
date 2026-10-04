"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AttendanceMonitoringTab } from "./attendance-monitoring-tab";
import { AttendanceRecapTab } from "./attendance-recap-tab";

/**
 * Halaman Absensi HRD/super admin — dua tab:
 * - Monitoring: roster harian per shift (siapa sudah/belum absen, cuti,
 *   libur, tanpa jadwal) dari /api/hris/attendance/daily-roster.
 * - Rekap: tabel absensi berpagination + filter + export CSV + kalender
 *   per-karyawan.
 * Absen dilakukan karyawan via ESS (/dashboard/me/absensi) dengan selfie +
 * GPS — halaman ini murni monitoring & rekap utk HRD.
 */
export function AttendancePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Absensi & Timesheet</h1>
        <p className="text-sm text-gray-500 mt-1">
          Monitoring kehadiran per shift dan rekap absensi karyawan
        </p>
      </div>

      <Tabs defaultValue="monitoring" className="w-full flex-col">
        <TabsList className="grid h-9 w-full max-w-md grid-cols-2">
          <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
          <TabsTrigger value="rekap">Rekap</TabsTrigger>
        </TabsList>
        <TabsContent value="monitoring" className="mt-4">
          <AttendanceMonitoringTab />
        </TabsContent>
        <TabsContent value="rekap" className="mt-4">
          <AttendanceRecapTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
