"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HPPTrend } from "@/features/purchasing/dashboard/queries";
import { formatRupiah } from "@/lib/format";
import { TrendingUp, TrendingDown } from "lucide-react";

interface HPPTrendPanelProps {
  trends: HPPTrend[];
}

export function HPPTrendPanel({ trends }: HPPTrendPanelProps) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">HPP Trend</CardTitle>
        <p className="text-xs text-gray-500">HPP produk utama vs bulan lalu</p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 text-xs font-medium text-gray-500">Produk</th>
                <th className="text-right py-2 text-xs font-medium text-gray-500">HPP Lama</th>
                <th className="text-right py-2 text-xs font-medium text-gray-500">HPP Baru</th>
                <th className="text-right py-2 text-xs font-medium text-gray-500">Δ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {trends.map((row) => {
                const isUp = row.change_percent > 0;
                const isDown = row.change_percent < 0;
                return (
                  <tr key={row.product_name}>
                    <td className="py-2.5 font-medium text-gray-900">{row.product_name}</td>
                    <td className="py-2.5 text-right text-gray-500">{formatRupiah(row.previous_hpp)}</td>
                    <td className="py-2.5 text-right font-semibold text-gray-900">{formatRupiah(row.current_hpp)}</td>
                    <td className="py-2.5 text-right">
                      <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${
                        isUp ? "text-red-500" : isDown ? "text-green-600" : "text-gray-400"
                      }`}>
                        {isUp ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : isDown ? (
                          <TrendingDown className="w-3 h-3" />
                        ) : null}
                        {isUp ? "+" : ""}{row.change_percent.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
