"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { formatDate, formatRupiah, formatRupiahCompact } from "@/lib/format";
import type { PurchasePriceHistoryItem } from "@/features/purchasing/suppliers/price-history-types";

interface PriceHistoryChartProps {
  data: PurchasePriceHistoryItem[];
  materialName?: string;
  height?: number;
}

interface PriceTooltipProps {
  active?: boolean;
  payload?: { payload: PurchasePriceHistoryItem }[];
  label?: string;
}

function PriceTooltip({ active, payload, label }: PriceTooltipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const change = point.price_change_percent;
  return (
    <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
      <p className="text-sm font-medium text-gray-700 mb-1">{formatDate(label)}</p>
      <p className="text-lg font-bold text-blue-600">{formatRupiah(point.harga)}</p>
      <p className="text-xs text-gray-500">per {point.satuan_nama}</p>
      {change !== null && change !== undefined && (
        <p
          className={`text-xs font-medium mt-1 ${
            change > 0 ? "text-red-500" : change < 0 ? "text-green-500" : "text-gray-400"
          }`}
        >
          {change > 0 ? "↑" : change < 0 ? "↓" : "→"} {Math.abs(change)}% dari sebelumnya
        </p>
      )}
    </div>
  );
}

export function PriceHistoryChart({ 
  data, 
  materialName,
  height = 300 
}: PriceHistoryChartProps) {
  // Sort data by date ascending for chart
  const sortedData = [...data].sort(
    (a, b) => new Date(a.tanggal).getTime() - new Date(b.tanggal).getTime()
  );

  // Calculate min and max for Y axis domain
  const prices = sortedData.map(d => d.harga);
  const minPrice = Math.min(...prices) * 0.95; // Add 5% padding
  const maxPrice = Math.max(...prices) * 1.05;

  if (sortedData.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <div className="text-center text-gray-400">
          <p className="text-sm">Belum ada riwayat pembelian</p>
        </div>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={sortedData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e3dbcc" />
        <XAxis
          dataKey="tanggal"
          tickFormatter={(value: string) => formatDate(value)}
          angle={-45}
          textAnchor="end"
          interval={0}
          tick={{ fontSize: 12 }}
          height={60}
        />
        <YAxis
          domain={[minPrice, maxPrice]}
          tickFormatter={(value: number) => formatRupiahCompact(value)}
          tick={{ fontSize: 12 }}
        />
        <Tooltip content={<PriceTooltip />} />
        <Legend 
          verticalAlign="top" 
          height={36}
          formatter={() => materialName || "Harga"}
        />
        
        {/* Average price line */}
        <ReferenceLine
          y={prices.reduce((a, b) => a + b, 0) / prices.length}
          stroke="#203b32"
          strokeDasharray="3 3"
          label={{ 
            value: "Rata-rata", 
            position: "right",
            fill: "#203b32",
            fontSize: 12
          }}
        />

        {/* Main price trend line */}
        <Line
          type="monotone"
          dataKey="harga"
          stroke="#00281a"
          strokeWidth={3}
          dot={{ fill: "#00281a", strokeWidth: 2, r: 5 }}
          activeDot={{ r: 7, fill: "#c9a227" }}
          name="Harga"
          animationDuration={1000}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
