"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StockAlert } from "@/features/purchasing/dashboard/queries";
import { RM_ROUTES } from "@/lib/purchasing/item-routes";
import { AlertTriangle, ArrowRight } from "lucide-react";
import Link from "next/link";

interface StockAlertPanelProps {
  alerts: StockAlert[];
}

export function StockAlertPanel({ alerts }: StockAlertPanelProps) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500" />
          Stok Alert
        </CardTitle>
        <p className="text-xs text-gray-500">Bahan dengan qty di bawah minimum</p>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">Semua stok tercukupi ✓</p>
        ) : (
          <div className="space-y-2">
            {alerts.map((alert) => {
              const pct = alert.minimum_stok > 0
                ? (alert.qty_on_hand / alert.minimum_stok) * 100
                : 0;
              const isCritical = alert.qty_on_hand === 0 || alert.alert_level === "critical";
              const isWarning = !isCritical && pct < 50;

              return (
                <div
                  key={alert.id}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    isCritical
                      ? "border-red-200 bg-red-50"
                      : isWarning
                      ? "border-orange-200 bg-orange-50"
                      : "border-yellow-100 bg-yellow-50"
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <AlertTriangle
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        isCritical ? "text-red-500" : "text-orange-400"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{alert.material_name}</p>
                      <p className="text-xs text-gray-500">{alert.category}</p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-1.5 w-20">
                          <div
                            className={`h-1.5 rounded-full ${
                              isCritical ? "bg-red-500" : "bg-orange-400"
                            }`}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <span className={`text-xs font-medium ${
                          isCritical ? "text-red-600" : "text-orange-600"
                        }`}>
                          {alert.qty_on_hand} {alert.unit} / {alert.minimum_stok} {alert.unit}
                        </span>
                      </div>
                    </div>
                  </div>
                  <Link href={RM_ROUTES.materials}>
                    <ArrowRight className="w-4 h-4 text-gray-400 hover:text-gray-600" />
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
