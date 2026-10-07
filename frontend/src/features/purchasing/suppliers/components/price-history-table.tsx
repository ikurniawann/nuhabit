"use client";

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { formatRupiah, formatDate } from "@/lib/format";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { PurchasePriceHistoryItem } from "@/features/purchasing/suppliers/price-history-types";

interface PriceHistoryTableProps {
  data: PurchasePriceHistoryItem[];
  showMaterialName?: boolean;
}

function ChangeBadge({ change }: { change: number | null | undefined }) {
  if (change === null || change === undefined) {
    return (
      <span className="flex items-center justify-center gap-1 text-xs text-gray-400">
        <Minus className="w-3 h-3" />
        -
      </span>
    );
  }

  const isPositive = change > 0;
  const isNegative = change < 0;

  return (
    <span className={`flex items-center justify-center gap-1 text-xs font-medium ${
      isPositive ? "text-red-600" : isNegative ? "text-green-600" : "text-gray-400"
    }`}>
      {isPositive ? <TrendingUp className="w-3 h-3" /> : isNegative ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
      {isPositive ? "+" : ""}{change.toFixed(2)}%
    </span>
  );
}

export function PriceHistoryTable({
  data,
  showMaterialName = false
}: PriceHistoryTableProps) {
  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        Belum ada riwayat pembelian
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200/70">
      <Table>
        <TableHeader>
          <TableRow className="border-b border-gray-200/70 bg-gray-50 hover:bg-gray-50">
            <TableHead className="w-32">Tanggal Terima</TableHead>
            {showMaterialName && <TableHead>Bahan Baku</TableHead>}
            <TableHead>Harga Satuan</TableHead>
            <TableHead className="text-right">Qty Diterima</TableHead>
            <TableHead className="text-center">Perubahan</TableHead>
            <TableHead>No. Penerimaan</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((item) => (
            <TableRow key={item.id} className="border-b border-gray-100 last:border-0">
              <TableCell className="font-medium">{formatDate(item.tanggal)}</TableCell>
              {showMaterialName && (
                <TableCell className="font-medium">{item.bahan_baku_nama}</TableCell>
              )}
              <TableCell className="font-semibold text-blue-600">
                {formatRupiah(item.harga)}
                <div className="text-xs text-gray-400 font-normal">
                  per {item.satuan_nama || "satuan dasar"}
                </div>
              </TableCell>
              <TableCell className="text-right">
                {item.qty} {item.satuan_nama}
              </TableCell>
              <TableCell className="text-center">
                <ChangeBadge change={item.price_change_percent} />
              </TableCell>
              <TableCell className="text-sm text-gray-500">
                {item.reference_number || "-"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
