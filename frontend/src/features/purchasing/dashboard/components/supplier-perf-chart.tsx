"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { SupplierPerformance } from "@/features/purchasing/dashboard/queries";
import { Truck } from "lucide-react";

interface SupplierPerfChartProps {
  suppliers: SupplierPerformance[];
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs space-y-1">
      <p className="font-semibold text-gray-700 mb-1.5">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center justify-between gap-4">
          <span style={{ color: entry.color }}>{entry.name}</span>
          <span className="font-medium text-gray-900">{entry.value}%</span>
        </div>
      ))}
    </div>
  );
}

export function SupplierPerfChart({ suppliers }: SupplierPerfChartProps) {
  const sorted = [...suppliers].sort((a, b) => b.on_time_rate - a.on_time_rate);
  const chartData = sorted.map((s) => ({
    name: s.supplier_name.length > 12 ? s.supplier_name.slice(0, 11) + "…" : s.supplier_name,
    "On-Time Rate": s.on_time_rate,
    "QC Pass Rate": s.qc_pass_rate,
    "Avg Lead Time": Math.round((1 - s.avg_lead_time_days / 10) * 100),
  }));

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Truck className="w-4 h-4 text-indigo-500" />
          Performa Supplier
        </CardTitle>
        <p className="text-xs text-gray-500">On-time & QC pass rate per supplier</p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={chartData}
            margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
            barCategoryGap="30%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#6b7280" }} />
            <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} domain={[0, 100]} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="On-Time Rate" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            <Bar dataKey="QC Pass Rate" fill="#10b981" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
