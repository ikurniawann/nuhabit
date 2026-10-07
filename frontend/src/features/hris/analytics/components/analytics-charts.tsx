import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowTrendingDownIcon } from "@heroicons/react/24/outline";
import {
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
import type { AnalyticsView } from "@/lib/recruitment/analytics-view";

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#203b32", "#14b8a6"];
const color = (i: number) => COLORS[i % COLORS.length];

const rateColor = (rate: number) => (rate > 50 ? "#22c55e" : rate > 25 ? "#f59e0b" : "#ef4444");

const pipelineBadge = (count: number) =>
  count > 5 ? "bg-red-100 text-red-700" : count > 2 ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700";

function ChartCard({
  title, loading, empty, emptyNode, className, children,
}: {
  title: ReactNode;
  loading: boolean;
  empty: boolean;
  emptyNode?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-gray-700">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-48 bg-gray-50 rounded animate-pulse" />
        ) : empty ? (
          emptyNode ?? <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Belum ada data</div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

export function AnalyticsCharts({ view, loading }: { view: AnalyticsView; loading: boolean }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <ChartCard title="Trend Bulanan: Applied vs Hired" loading={loading} empty={false} className="lg:col-span-2">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={view.monthlyTrend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="applied" fill="#6366f1" radius={[4, 4, 0, 0]} name="Dilamar" />
            <Bar dataKey="hired" fill="#22c55e" radius={[4, 4, 0, 0]} name="Dihire" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Conversion Rate per Tahapan" loading={loading} empty={view.conversionRates.length === 0}>
        <div className="space-y-3">
          {view.conversionRates.map((c) => (
            <div key={c.stage}>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>{c.stage}</span>
                <span className="font-medium">{c.rate}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className="h-2 rounded-full transition-all duration-500"
                  style={{ width: `${c.rate}%`, backgroundColor: rateColor(c.rate) }}
                />
              </div>
            </div>
          ))}
        </div>
      </ChartCard>

      <ChartCard title="Sumber Kandidat Terbaik" loading={loading} empty={view.topSources.length === 0}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={view.topSources} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
            <YAxis type="category" dataKey="source" tick={{ fontSize: 11 }} width={80} />
            <Tooltip />
            <Bar dataKey="hired" fill="#22c55e" radius={[0, 4, 4, 0]} name="Hired" />
            <Bar dataKey="total" fill="#e5e7eb" radius={[0, 4, 4, 0]} name="Total" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title={
          <span className="flex items-center gap-2">
            <ArrowTrendingDownIcon className="w-4 h-4 text-red-500" />
            Posisi Paling Lama di Pipeline
          </span>
        }
        loading={loading}
        empty={view.hardToFill.length === 0}
        emptyNode={<div className="py-8 text-center text-gray-400 text-sm">Semua posisi terisi dengan baik</div>}
      >
        <div className="space-y-2">
          {view.hardToFill.map((h, i) => (
            <div key={h.position_id} className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-gray-300">#{i + 1}</span>
                <div>
                  <p className="text-sm font-medium text-gray-900">{h.position_title}</p>
                  <p className="text-xs text-gray-400">{h.count} kandidat di pipeline</p>
                </div>
              </div>
              <Badge className={`text-xs ${pipelineBadge(h.count)}`}>{h.count} kandidat</Badge>
            </div>
          ))}
        </div>
      </ChartCard>

      <ChartCard title="Perbandingan Brand / Outlet" loading={loading} empty={view.brandComparison.length === 0}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={view.brandComparison}>
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
      </ChartCard>

      <ChartCard title="Distribusi Hire per Brand" loading={loading} empty={view.hiredByBrand.length === 0}>
        <div className="flex items-center gap-4">
          <ResponsiveContainer width="55%" height={180}>
            <PieChart>
              <Pie
                data={view.hiredByBrand}
                cx="50%"
                cy="50%"
                outerRadius={75}
                dataKey="value"
                label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                labelLine={false}
                fontSize={10}
              >
                {view.hiredByBrand.map((s, i) => <Cell key={s.name} fill={color(i)} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-1">
            {view.hiredByBrand.map((s, i) => (
              <div key={s.name} className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color(i) }} />
                <span className="text-gray-600 truncate">{s.name}</span>
                <span className="ml-auto font-medium">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </ChartCard>
    </div>
  );
}
