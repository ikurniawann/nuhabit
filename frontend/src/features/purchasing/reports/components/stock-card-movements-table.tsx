import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { MOVEMENT_TYPE_LABELS, MOVEMENT_TYPE_STYLES, movementDelta } from "@/lib/purchasing/report-ui-stock-card";
import type { StockCardItemType, StockMovement } from "../types";
import { ReportTableMessage } from "./report-ui";

type StockCardMovementsTableProps = {
  movements: StockMovement[];
  loading: boolean;
  itemType: StockCardItemType;
};

export function StockCardMovementsTable({ movements, loading, itemType }: StockCardMovementsTableProps) {
  return (
    <table className="w-full min-w-[1100px] text-sm">
      <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <tr>
          <th className="px-3 py-3">Tanggal</th>
          <th className="px-3 py-3">Item</th>
          <th className="px-3 py-3">Tipe</th>
          <th className="px-3 py-3">Referensi</th>
          <th className="px-3 py-3">Alasan</th>
          <th className="px-3 py-3 text-right">Before</th>
          <th className="px-3 py-3 text-right">Mutasi</th>
          <th className="px-3 py-3 text-right">After</th>
          <th className="px-3 py-3 text-right">Unit Cost</th>
          <th className="px-3 py-3 text-right">Nilai</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200/70">
        {loading ? (
          <ReportTableMessage colSpan={10}>Memuat stock card...</ReportTableMessage>
        ) : movements.length === 0 ? (
          <ReportTableMessage colSpan={10}>
            {itemType === "product"
              ? "Belum ada mutasi produk untuk filter ini. Mutasi tercatat mulai produksi/opname/adjustment berikutnya."
              : "Belum ada mutasi untuk filter ini."}
          </ReportTableMessage>
        ) : (
          movements.map((movement) => {
            const delta = movementDelta(movement);
            return (
              <tr key={movement.id} className="hover:bg-muted/40">
                <td className="whitespace-nowrap px-3 py-3 text-foreground">{formatDateTime(movement.created_at)}</td>
                <td className="px-3 py-3">
                  <p className="font-medium text-foreground">{movement.item_nama || movement.material_nama}</p>
                  <p className="font-mono text-xs text-muted-foreground">{movement.item_kode || movement.material_kode}</p>
                </td>
                <td className="px-3 py-3">
                  <Badge className={MOVEMENT_TYPE_STYLES[movement.tipe]}>{MOVEMENT_TYPE_LABELS[movement.tipe]}</Badge>
                </td>
                <td className="px-3 py-3">
                  <p className="font-medium text-foreground">{movement.reference_number}</p>
                  <p className="text-xs text-muted-foreground">{movement.reference_type}</p>
                </td>
                <td className="px-3 py-3 text-muted-foreground">{movement.alasan}</td>
                <td className="px-3 py-3 text-right text-muted-foreground">{formatNumber(movement.qty_before, 3)}</td>
                <td className={`px-3 py-3 text-right font-semibold ${delta < 0 ? "text-red-600" : "text-emerald-600"}`}>
                  {delta > 0 ? "+" : ""}
                  {formatNumber(delta, 3)}
                </td>
                <td className="px-3 py-3 text-right font-semibold text-foreground">
                  {formatNumber(movement.qty_after, 3)}
                </td>
                <td className="px-3 py-3 text-right text-muted-foreground">{formatRupiah(movement.unit_cost)}</td>
                <td className="px-3 py-3 text-right font-semibold text-brand-text">{formatRupiah(movement.total_cost)}</td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}
