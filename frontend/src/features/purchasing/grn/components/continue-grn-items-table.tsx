import { NumericInput } from "@/components/ui/numeric-input";
import { formatNumber } from "@/lib/format";
import {
  findPoLine,
  maxTotalGoodQty,
  poRemainingQty,
  type ContinueGrnLine,
  type PoLine,
} from "@/lib/purchasing/grn-ui-lines";

const qty = (value: number) => formatNumber(value, 4);

type Props = {
  lines: ContinueGrnLine[];
  poLines: PoLine[];
  onGoodQtyChange: (index: number, value: number) => void;
};

/** Tabel qty baik/tolak per baris GRN saat melanjutkan penerimaan. */
export function ContinueGrnItemsTable({ lines, poLines, onGoodQtyChange }: Props) {
  return (
    <div className="p-4">
      <div className="overflow-x-auto rounded-xl border border-gray-200/70">
        <table className="w-full table-fixed border-collapse text-sm [&_td]:border [&_td]:border-gray-200/70 [&_th]:border [&_th]:border-gray-200/70">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Bahan Baku</th>
              <th className="w-[72px] px-2 py-3 text-center font-semibold">Dipesan</th>
              <th className="w-[72px] px-2 py-3 text-center font-semibold">Diterima</th>
              <th className="w-[84px] px-2 py-3 text-center font-semibold">Sisa</th>
              <th className="w-[104px] px-1.5 py-3 text-center font-semibold">Baik</th>
              <th className="w-[104px] px-1.5 py-3 text-center font-semibold">Tolak</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const po = findPoLine(line, poLines);
              const ordered = po?.qty_ordered ?? 0;
              const remaining = poRemainingQty(po);
              const sku = line.pos_sku || po?.pos_sku;
              return (
                <tr key={line.id} className="bg-white hover:bg-gray-50/80">
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium text-gray-900">{line.nama_bahan}</div>
                    {sku && (
                      <div className="mt-0.5 text-xs text-gray-500">
                        Varian: {sku.sku} — {sku.name}
                      </div>
                    )}
                    {ordered > 0 && (
                      <div className="mt-0.5 text-xs text-gray-500">
                        PO: {qty(ordered)} {po?.satuan || line.satuan}
                      </div>
                    )}
                    {!po && <div className="mt-0.5 text-xs text-amber-600">Data item purchase order tidak lengkap.</div>}
                    {(line.previous_qty_diterima > 0 || line.previous_qty_ditolak > 0) && (
                      <div className="mt-1 text-xs text-gray-500">
                        Penerimaan sebelumnya: {qty(line.previous_qty_diterima)} baik
                        {line.previous_qty_ditolak > 0 ? `, ${qty(line.previous_qty_ditolak)} tolak` : ""}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-3 text-center align-middle text-gray-700">{qty(ordered)}</td>
                  <td className="px-2 py-3 text-center align-middle text-gray-700">{qty(po?.qty_received ?? 0)}</td>
                  <td className="px-2 py-3 text-center align-middle font-semibold text-pink-700">{qty(remaining)}</td>
                  <td className="px-1.5 py-1.5 align-middle">
                    <NumericInput
                      min={line.previous_qty_diterima}
                      max={maxTotalGoodQty(line, po) || undefined}
                      value={line.qty_diterima}
                      onValueChange={(value) => onGoodQtyChange(index, value || 0)}
                      decimalScale={4}
                      disabled={remaining <= 0 && line.qty_diterima <= line.previous_qty_diterima}
                      className="h-9 w-full border-gray-200/80 bg-white px-2 text-center text-sm focus-visible:border-pink-300 focus-visible:ring-1 focus-visible:ring-pink-200/80 disabled:bg-gray-50"
                    />
                  </td>
                  <td className="px-1.5 py-1.5 align-middle">
                    <div
                      className={`flex h-9 w-full items-center justify-center rounded-lg border border-gray-200/80 bg-gray-50 px-2 text-sm font-medium ${
                        line.qty_ditolak > 0 ? "text-red-600" : "text-gray-700"
                      }`}
                    >
                      {qty(line.qty_ditolak)}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
