"use client";

import { Card, CardContent } from "@/components/ui/card";
import { formatRupiah } from "@/lib/format";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { PurchasingKPIs } from "@/features/purchasing/dashboard/queries";

interface KPICardsProps {
  kpis: PurchasingKPIs;
}

function TrendBadge({ value }: { value: number }) {
  if (value > 0) {
    return (
      <span className="flex items-center gap-0.5 text-xs font-medium text-green-600">
        <TrendingUp className="w-3 h-3" />
        +{value.toFixed(1)}%
      </span>
    );
  }
  if (value < 0) {
    return (
      <span className="flex items-center gap-0.5 text-xs font-medium text-red-500">
        <TrendingDown className="w-3 h-3" />
        {value.toFixed(1)}%
      </span>
    );
  }
  return (
    <span className="flex items-center gap-0.5 text-xs font-medium text-gray-400">
      <Minus className="w-3 h-3" /> 0%
    </span>
  );
}

export function KPICards({ kpis }: KPICardsProps) {
  const cards = [
    {
      label: "Total PO Bulan Ini",
      value: kpis.totalPOCount.toString(),
      unit: "PO",
      sub: "vs bulan lalu",
      change: kpis.totalPOCountChange,
      icon: "📦",
      accent: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "Nilai Pembelian",
      value: formatRupiah(kpis.totalPOValue),
      unit: "",
      sub: "vs bulan lalu",
      change: kpis.totalPOValueChange,
      icon: "💰",
      accent: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      label: "Stok di Bawah Min.",
      value: kpis.lowStockCount.toString(),
      unit: "item",
      sub: "perlu reorder",
      change: null,
      icon: "⚠️",
      accent: kpis.lowStockCount > 5 ? "text-red-600" : "text-orange-500",
      bg: kpis.lowStockCount > 5 ? "bg-red-50" : "bg-orange-50",
    },
    {
      label: "PO Menunggu Approval",
      value: kpis.pendingApprovalCount.toString(),
      unit: "PO",
      sub: "pending",
      change: null,
      icon: "⏳",
      accent: "text-amber-600",
      bg: "bg-amber-50",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <Card key={card.label} className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-2">
              <span className={`inline-flex p-2 rounded-lg ${card.bg}`}>
                <span className="text-lg">{card.icon}</span>
              </span>
              {card.change !== null && <TrendBadge value={card.change} />}
            </div>
            <p className={`text-2xl font-bold ${card.accent}`}>{card.value}</p>
            <p className="text-xs text-gray-500 font-medium mt-0.5">{card.label}</p>
            <p className="text-xs text-gray-400">{card.sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
