import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  UsersIcon,
  ArrowTrendingDownIcon,
  UserPlusIcon,
  UserMinusIcon,
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
import { statusSlices, type HrisReport } from "@/lib/hris/hris-reports-csv";
import { CsvButton, SectionTitle, StatCard, reportColor } from "./report-ui";

export function HeadcountSection({
  report, monthLabel, onExport,
}: {
  report: HrisReport;
  monthLabel: string;
  onExport: () => void;
}) {
  const h = report.headcount;
  const slices = statusSlices(report);
  return (
    <>
      <div>
        <SectionTitle icon={<UsersIcon className="w-4 h-4" />}>Headcount</SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Aktif"
            value={h.total_active}
            sub="karyawan aktif"
            icon={<UsersIcon className="w-5 h-5" />}
            color="blue"
          />
          <StatCard
            title="Karyawan Baru"
            value={h.new_hires}
            sub={`bergabung ${monthLabel}`}
            icon={<UserPlusIcon className="w-5 h-5" />}
            color="green"
          />
          <StatCard
            title="Turnover YTD"
            value={h.turnover_count}
            sub="resign/PHK tahun ini"
            icon={<UserMinusIcon className="w-5 h-5" />}
            color="red"
          />
          <StatCard
            title="Turnover Rate"
            value={`${h.turnover_rate}%`}
            sub="tahun berjalan"
            icon={<ArrowTrendingDownIcon className="w-5 h-5" />}
            color={h.turnover_rate > 10 ? "red" : "yellow"}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold text-gray-700">Komposisi Status Karyawan</CardTitle>
          </CardHeader>
          <CardContent>
            {slices.length === 0 ? (
              <p className="text-center text-gray-400 py-8 text-sm">Tidak ada data</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={slices} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                    {slices.map((s, i) => (
                      <Cell key={s.name} fill={reportColor(i)} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => [`${v} orang`, ""]} />
                  <Legend iconType="circle" iconSize={8} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold text-gray-700">Headcount per Departemen</CardTitle>
            <CsvButton onClick={onExport} />
          </CardHeader>
          <CardContent>
            {h.by_department.length === 0 ? (
              <p className="text-center text-gray-400 py-8 text-sm">Tidak ada data departemen</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={h.by_department} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip formatter={(v) => [`${v} orang`, "Karyawan"]} />
                  <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-700">Tren Headcount 6 Bulan</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={h.monthly_trend} margin={{ left: 0, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [`${v} orang`, "Headcount"]} />
              <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </>
  );
}

export function TurnoverSummary({ report, year }: { report: HrisReport; year: number }) {
  const h = report.headcount;
  const high = h.turnover_rate > 10;
  return (
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
            <p className="text-2xl font-bold text-gray-900">{h.total_active}</p>
            <p className="text-xs text-gray-500 mt-1">Karyawan Aktif Saat Ini</p>
          </div>
          <div className="bg-red-50 rounded-xl p-4">
            <p className="text-2xl font-bold text-red-700">{h.turnover_count}</p>
            <p className="text-xs text-gray-500 mt-1">Keluar Tahun {year}</p>
          </div>
          <div className={`rounded-xl p-4 ${high ? "bg-red-50" : "bg-green-50"}`}>
            <p className={`text-2xl font-bold ${high ? "text-red-700" : "text-green-700"}`}>
              {h.turnover_rate}%
            </p>
            <p className="text-xs text-gray-500 mt-1">Turnover Rate</p>
            <Badge className={`mt-1 text-xs ${high ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
              {high ? "Di atas normal" : "Normal"}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
