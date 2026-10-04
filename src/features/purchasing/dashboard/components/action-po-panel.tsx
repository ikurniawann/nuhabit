"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ActionPO } from "@/features/purchasing/dashboard/queries";
import { formatDate } from "@/lib/format";
import { getPOStatusLabel } from "@/lib/purchasing/status-labels";
import { AlertCircle, Clock, Eye } from "lucide-react";
import Link from "next/link";

interface ActionPOPanelProps {
  pos: ActionPO[];
}

export function ActionPOPanel({ pos }: ActionPOPanelProps) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-orange-500" />
          PO Perlu Tindakan
        </CardTitle>
        <p className="text-xs text-gray-500">PO overdue atau menunggu approval</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {pos.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Semua PO dalam kondisi baik ✓</p>
          ) : (
            pos.map((po) => {
              const { label, color } = getPOStatusLabel(po.status);
              const isOverdue = po.days_overdue > 0 && po.status === "sent";
              return (
                <div
                  key={po.id}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    isOverdue ? "border-red-200 bg-red-50" : "border-gray-100 bg-gray-50"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {isOverdue ? (
                      <Clock className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                    )}
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{po.po_number}</p>
                      <p className="text-xs text-gray-500">{po.supplier_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Expected: {formatDate(po.expected_date)}
                        {isOverdue && (
                          <span className="text-red-500 font-medium ml-1">
                            (+{po.days_overdue} hari)
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <Badge className={color}>{label}</Badge>
                    <Link href={`/dashboard/purchasing/purchase-orders/${po.id}`}>
                      <Button variant="ghost" size="sm" className="h-7 px-2">
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
