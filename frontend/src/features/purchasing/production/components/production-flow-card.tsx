"use client";

import Link from "next/link";
import { Layers, PackageCheck, PackageMinus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";
import type { ProductionFlow } from "@/lib/purchasing/production-flow";
import { recipeUnitNote } from "@/lib/purchasing/production-ui-display";

type ProductionFlowCardProps = {
  flow: ProductionFlow;
  busy: boolean;
  batchRoute: (id: string) => string;
  onIssue: () => void;
  onReceive: () => void;
};

function pct(value: number | null) {
  return value === null ? "-" : `${formatNumber(value, 2)}%`;
}

/** Langkah Produksi: keluarkan bahan ke WIP, terima hasil per batch, saldo WIP. */
export function ProductionFlowCard({ flow, busy, batchRoute, onIssue, onReceive }: ProductionFlowCardProps) {
  const { wip } = flow;
  const stats = [
    { label: "Bahan dikeluarkan", value: formatRupiah(wip.issued_cost) },
    { label: "Saldo WIP", value: formatRupiah(wip.wip_value), strong: true },
    { label: "Masuk ke stok", value: formatRupiah(wip.received_material_cost) },
    { label: "Hasil baik / scrap", value: `${formatNumber(wip.qty_good, 3)} / ${formatNumber(wip.qty_scrap, 3)}` },
    { label: "Yield", value: pct(wip.yield_pct) },
    { label: "Bahan standar / unit", value: formatRupiah(wip.std_material_per_unit) },
  ];

  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="flex flex-col gap-3 border-b border-gray-200/70 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-pink-50 text-pink-600">
            <Layers className="h-5 w-5" />
          </span>
          <div>
            <CardTitle className="text-base">Langkah Produksi</CardTitle>
            <p className="text-xs text-gray-500">
              Keluarkan bahan bertahap ke WIP, lalu terima hasil per batch. HPP dihitung per batch.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {flow.can_issue && (
            <Button
              type="button"
              variant="outline"
              onClick={onIssue}
              disabled={busy}
              className="purchasing-secondary-button w-full gap-2 sm:w-auto"
            >
              <PackageMinus className="h-4 w-4" />
              Keluarkan Bahan
            </Button>
          )}
          {flow.can_receive && (
            <Button type="button" onClick={onReceive} disabled={busy} className="purchasing-main-button w-full gap-2 sm:w-auto">
              <PackageCheck className="h-4 w-4" />
              Terima Hasil
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-4">
        <dl className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {stats.map((stat) => (
            <div key={stat.label} className={`rounded-lg px-3 py-2 ${stat.strong ? "bg-pink-50" : "bg-gray-50"}`}>
              <dt className="text-xs text-gray-500">{stat.label}</dt>
              <dd className={`mt-1 font-semibold ${stat.strong ? "text-pink-800" : "text-gray-900"}`}>{stat.value}</dd>
            </div>
          ))}
        </dl>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <caption className="sr-only">Pengeluaran bahan per baris</caption>
            <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="py-2 text-left font-semibold">Bahan</th>
                <th className="py-2 text-right font-semibold">Rencana</th>
                <th className="py-2 text-right font-semibold">Dikeluarkan</th>
                <th className="py-2 text-right font-semibold">Sisa</th>
                <th className="py-2 text-right font-semibold">Nilai</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {flow.materials.map((m) => (
                <tr key={m.id}>
                  <td className="py-2 pr-3">
                    <p className="font-medium text-gray-900">{m.nama}</p>
                    <p className="text-xs text-gray-500">{m.kode}</p>
                  </td>
                  <td className="py-2 text-right">
                    <p>
                      {formatNumber(m.qty_planned, 4)} {m.satuan}
                    </p>
                    {recipeUnitNote(m.recipe_qty, m.recipe_satuan, m.satuan) && (
                      <p className="text-xs text-gray-500">{recipeUnitNote(m.recipe_qty, m.recipe_satuan, m.satuan)}</p>
                    )}
                  </td>
                  <td className="py-2 text-right">{formatNumber(m.qty_issued, 4)}</td>
                  <td className="py-2 text-right">{formatNumber(m.qty_remaining, 4)}</td>
                  <td className="py-2 text-right font-medium">{formatRupiah(m.issued_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {flow.issues.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-900">Riwayat Pengeluaran</h3>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
              {flow.issues.map((issue) => (
                <li key={issue.id} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{issue.nomor_issue}</p>
                    <p className="text-xs text-gray-500">
                      {formatDate(issue.created_at)} · {issue.lines.map((l) => `${l.nama} ${formatNumber(l.qty, 4)}`).join(", ")}
                    </p>
                  </div>
                  <span className="font-semibold text-gray-900">{formatRupiah(issue.total_cost)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {flow.batches.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-900">Batch Hasil</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <caption className="sr-only">Batch hasil produksi</caption>
                <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="py-2 text-left font-semibold">Batch</th>
                    <th className="py-2 text-right font-semibold">Baik</th>
                    <th className="py-2 text-right font-semibold">Scrap</th>
                    <th className="py-2 text-right font-semibold">Yield</th>
                    <th className="py-2 text-right font-semibold">Total Biaya</th>
                    <th className="py-2 text-right font-semibold">HPP / Unit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {flow.batches.map((batch) => (
                    <tr key={batch.id}>
                      <td className="py-2 pr-3">
                        <Link href={batchRoute(batch.id)} className="font-medium text-pink-700 hover:underline">
                          {batch.batch_number}
                        </Link>
                        {batch.is_final && (
                          <Badge variant="outline" className="ml-2 border-emerald-200/80 bg-emerald-50 text-emerald-700">
                            Terakhir
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 text-right">{formatNumber(batch.qty_good, 3)}</td>
                      <td className="py-2 text-right">{formatNumber(batch.qty_scrap, 3)}</td>
                      <td className="py-2 text-right">{pct(batch.yield_pct)}</td>
                      <td className="py-2 text-right">{formatRupiah(batch.total_cost)}</td>
                      <td className="py-2 text-right font-semibold text-emerald-700">{formatRupiah(batch.hpp_per_unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
