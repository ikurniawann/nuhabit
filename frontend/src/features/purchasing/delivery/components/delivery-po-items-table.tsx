import { formatNumber, formatRupiah } from "@/lib/format";
import { deliveryItemRemaining } from "@/lib/purchasing/receiving-ui-delivery";
import type { PurchaseOrderItem } from "@/types/purchasing";

/** Item PO bahan baku; pada kirim ulang baris tanpa sisa diredupkan. */
export function DeliveryPoItemsTable({ items, isReship }: { items: PurchaseOrderItem[]; isReship: boolean }) {
  return (
    <div className="overflow-x-auto px-4 pb-4">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200/70 text-xs uppercase tracking-wide text-gray-500">
            <th className="py-3 pr-4 text-left font-semibold">Bahan Baku</th>
            <th className="px-3 py-3 text-right font-semibold">Dipesan</th>
            <th className="px-3 py-3 text-right font-semibold">Diterima</th>
            <th className="px-3 py-3 text-right font-semibold">Sisa</th>
            <th className="px-3 py-3 text-left font-semibold">Satuan</th>
            <th className="px-3 py-3 text-right font-semibold">Harga Satuan</th>
            <th className="py-3 pl-3 text-right font-semibold">Subtotal</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200/70">
          {items.map((item) => {
            const remaining = deliveryItemRemaining(item);
            const dimmed = isReship && remaining <= 0;
            return (
              <tr key={item.id} className={dimmed ? "bg-gray-50/60 text-gray-400" : "hover:bg-gray-50/80"}>
                <td className="py-3 pr-4">
                  <div className={`font-medium ${dimmed ? "text-gray-400" : "text-gray-900"}`}>{item.raw_material?.nama}</div>
                  <div className="text-xs text-gray-500">{item.raw_material?.kode}</div>
                </td>
                <td className="px-3 py-3 text-right text-gray-700">{formatNumber(item.qty_ordered, 4)}</td>
                <td className="px-3 py-3 text-right text-gray-700">{formatNumber(item.qty_received, 4)}</td>
                <td className={`px-3 py-3 text-right font-semibold ${remaining > 0 ? "text-brand-text" : "text-gray-400"}`}>
                  {formatNumber(remaining, 4)}
                  {isReship && remaining > 0 && (
                    <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-wide text-brand-text/80">
                      Kirim ulang
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-gray-700">
                  {item.satuan?.nama || item.raw_material?.satuan_besar?.nama || item.raw_material?.satuan || "-"}
                </td>
                <td className="px-3 py-3 text-right text-gray-700">{formatRupiah(item.harga_satuan)}</td>
                <td className="py-3 pl-3 text-right font-medium text-gray-900">{formatRupiah(item.subtotal)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
