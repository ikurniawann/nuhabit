import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ClockIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { HrisReport } from "@/lib/hris/hris-reports-csv";
import { CsvButton, SectionTitle, StatCard, reportColor } from "./report-ui";

interface SectionProps {
  report: HrisReport;
  periodLabel: string;
  onExport: () => void;
}

export function AttendanceSection({ report, periodLabel, onExport }: SectionProps) {
  const a = report.attendance;
  return (
    <>
      <div>
        <SectionTitle icon={<ClockIcon className="w-4 h-4" />}>Absensi — {periodLabel}</SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Tingkat Kehadiran"
            value={`${a.present_rate}%`}
            sub={`${a.present_count} dari ${a.total_records} hari`}
            icon={<CheckCircleIcon className="w-5 h-5" />}
            color={a.present_rate >= 90 ? "green" : "yellow"}
          />
          <StatCard
            title="Tingkat Keterlambatan"
            value={`${a.late_rate}%`}
            sub={`${a.late_count} kali terlambat`}
            icon={<ExclamationTriangleIcon className="w-5 h-5" />}
            color={a.late_rate > 15 ? "red" : "yellow"}
          />
          <StatCard
            title="Total Tidak Hadir"
            value={a.absent_count}
            sub="hari absen"
            icon={<ClockIcon className="w-5 h-5" />}
            color="red"
          />
          <StatCard
            title="Rata-rata Jam Kerja"
            value={`${a.avg_work_hours}j`}
            sub="per hari kerja"
            icon={<ClockIcon className="w-5 h-5" />}
            color="blue"
          />
        </div>
      </div>

      {a.daily_trend.length > 0 && (
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold text-gray-700">Tren Harian Absensi</CardTitle>
            <CsvButton onClick={onExport} />
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={a.daily_trend} margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={3} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend iconType="circle" iconSize={8} />
                <Bar dataKey="present" name="Hadir" fill="#abde67" stackId="a" radius={[0, 0, 0, 0]} />
                <Bar dataKey="late" name="Terlambat" fill="#c9a227" stackId="b" />
                <Bar dataKey="absent" name="Absen" fill="#1c261b" stackId="c" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </>
  );
}

export function LeaveSection({ report, periodLabel, onExport }: SectionProps) {
  const l = report.leaves;
  return (
    <>
      <div>
        <SectionTitle icon={<CalendarDaysIcon className="w-4 h-4" />}>Cuti & Izin — {periodLabel}</SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            title="Disetujui"
            value={l.approved_count}
            sub="pengajuan cuti"
            icon={<CheckCircleIcon className="w-5 h-5" />}
            color="green"
          />
          <StatCard
            title="Total Hari Cuti"
            value={l.total_days}
            sub="hari kerja digunakan"
            icon={<CalendarDaysIcon className="w-5 h-5" />}
            color="purple"
          />
          <StatCard
            title="Menunggu Approval"
            value={l.pending_count}
            sub="pengajuan pending"
            icon={<ExclamationTriangleIcon className="w-5 h-5" />}
            color={l.pending_count > 5 ? "yellow" : "blue"}
          />
        </div>
      </div>

      {l.by_type.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold text-gray-700">Cuti per Jenis (Hari)</CardTitle>
              <CsvButton onClick={onExport} />
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={l.by_type} margin={{ left: 0, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="type" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [`${v} hari`, ""]} />
                  <Bar dataKey="days" name="Hari" fill="#daff59" radius={[4, 4, 0, 0]}>
                    {l.by_type.map((t, i) => (
                      <Cell key={t.type} fill={reportColor(i)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-gray-700">Detail per Jenis</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {l.by_type.map((t, i) => (
                  <div key={t.type} className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: reportColor(i) }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">{t.type}</span>
                        <span className="font-semibold text-gray-900">{t.days} hari</span>
                      </div>
                      <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(t.days / l.total_days) * 100}%`, backgroundColor: reportColor(i) }}
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
    </>
  );
}
