import { Package } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber, formatRupiah } from "@/lib/format";
import type { PurchaseOrderItem } from "@/types/purchasing";

const qty = (value?: number | null) => formatNumber(value, 4);

function receivedClass(item: PurchaseOrderItem) {
  if (item.qty_received >= item.qty_ordered) return "text-green-600";
  return item.qty_received > 0 ? "text-yellow-600" : "text-gray-400";
}

/** Tabel item PO; kolom qty diterima tampil setelah PO berjalan (bukan draf/batal). */
export function POItemsCard({ items, showReceived }: { items: PurchaseOrderItem[]; showReceived: boolean }) {
  return (
    <Card className="border-gray-200/70 shadow-sm">
      <CardHeader className="border-b border-gray-100 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Package className="h-5 w-5" />
          Item Purchase Order
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Bahan Baku</th>
                <th className="px-4 py-3 text-right font-semibold">Qty</th>
                <th className="px-4 py-3 text-left font-semibold">Satuan</th>
                <th className="px-4 py-3 text-right font-semibold">Harga Satuan</th>
                <th className="px-4 py-3 text-right font-semibold">Subtotal</th>
                {showReceived && <th className="px-4 py-3 text-right font-semibold">Qty Diterima</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-900">{item.raw_material?.nama}</div>
                    <div className="text-xs text-gray-500">{item.raw_material?.kode}</div>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">{qty(item.qty_ordered)}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {item.satuan?.nama || item.raw_material?.satuan_besar?.nama || item.raw_material?.satuan || "-"}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatRupiah(item.harga_satuan)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatRupiah(item.subtotal)}</td>
                  {showReceived && (
                    <td className="px-4 py-3 text-right">
                      <div className={receivedClass(item)}>
                        {qty(item.qty_received)} / {qty(item.qty_ordered)}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
