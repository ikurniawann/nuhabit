"use client";

import { Input } from "@/components/ui/input";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { formatNumber } from "@/lib/format";
import {
  returnErrors,
  returnableMaterials,
  type ProductionFlowMaterial,
  type ReturnRows,
} from "@/lib/purchasing/production-flow";

const INPUT_CLASS = "h-9 w-28 text-right text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100";

type ReturnLinesTableProps = {
  materials: ProductionFlowMaterial[];
  rows: ReturnRows;
  onChange: (rows: ReturnRows) => void;
};

/** Isian jumlah kembali per bahan, dibatasi yang sudah keluar dan belum kembali. */
export function ReturnLinesTable({ materials, rows, onChange }: ReturnLinesTableProps) {
  const returnable = returnableMaterials(materials);
  const errors = new Set(returnErrors(rows, materials));
  if (returnable.length === 0) {
    return <p className="text-sm text-gray-500">Tidak ada bahan keluar yang bisa dikembalikan.</p>;
  }
  return (
    <ScrollRegion label="Tabel bahan yang dikembalikan" className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="py-2 text-left font-semibold">Bahan</th>
            <th className="py-2 text-right font-semibold">Sudah Keluar</th>
            <th className="py-2 text-right font-semibold">Bisa Kembali</th>
            <th className="py-2 text-right font-semibold">Kembalikan</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {returnable.map((m) => (
            <tr key={m.id}>
              <td className="py-2 pr-3">
                <p className="font-medium text-gray-900">{m.nama}</p>
                <p className="text-xs text-gray-500">{m.kode}</p>
              </td>
              <td className="py-2 text-right text-gray-700">
                {formatNumber(m.qty_issued, 4)} {m.satuan}
              </td>
              <td className="py-2 text-right text-gray-700">{formatNumber(m.qty_returnable, 4)}</td>
              <td className="py-2">
                <div className="flex flex-col items-end gap-1">
                  <Input
                    aria-label={`Jumlah ${m.nama} yang dikembalikan (${m.satuan || "satuan stok"})`}
                    value={rows[m.id] ?? ""}
                    onChange={(event) => onChange({ ...rows, [m.id]: event.target.value })}
                    type="number"
                    min="0"
                    max={m.qty_returnable}
                    step="any"
                    aria-invalid={errors.has(m.id) ? true : undefined}
                    className={INPUT_CLASS}
                  />
                  {errors.has(m.id) && <span className="text-xs font-medium text-red-600">Melebihi yang bisa kembali</span>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
