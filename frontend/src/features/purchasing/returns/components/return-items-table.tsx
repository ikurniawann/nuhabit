"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { NumericInput } from "@/components/ui/numeric-input";
import { formatNumber } from "@/lib/format";
import type { ReturnableItem } from "@/types/purchasing";

export type ReturnItemRow = ReturnableItem & {
  selected: boolean;
  qty_return: number;
  condition_notes: string;
  warehouse_name?: string | null;
};

interface ReturnItemsTableProps {
  /** create: kolom diterima & diretur; edit: kolom stall. */
  variant: "create" | "edit";
  items: ReturnItemRow[];
  isProduct: boolean;
  itemName: (item: ReturnItemRow) => { nama: string; kode: string };
  onToggle: (grnItemId: string) => void;
  onToggleAll: (checked: boolean) => void;
  onQtyChange: (grnItemId: string, qty: number) => void;
  onNotesChange: (grnItemId: string, notes: string) => void;
}

/** Tabel pilih item retur: centang, qty retur (dibatasi qty tersedia), dan kondisi. */
export function ReturnItemsTable({
  variant,
  items: returnableItems,
  isProduct,
  itemName,
  onToggle,
  onToggleAll,
  onQtyChange,
  onNotesChange,
}: ReturnItemsTableProps) {
  const allSelected = returnableItems.length > 0 && returnableItems.every((item) => item.selected);
  return (
    <table className="w-full table-fixed border-collapse text-sm [&_td]:border [&_td]:border-gray-200/70 [&_th]:border [&_th]:border-gray-200/70">
      <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
        <tr>
          <th className="w-10 px-2 py-3 text-center font-semibold">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(checked) => onToggleAll(checked === true)}
              aria-label="Pilih semua item"
            />
          </th>
          <th className="px-4 py-3 text-left font-semibold">
            {isProduct ? "Produk" : "Bahan Baku"}
          </th>
          {variant === "create" ? (
            <>
              <th className="w-[88px] px-2 py-3 text-center font-semibold">Diterima</th>
              <th className="w-[88px] px-2 py-3 text-center font-semibold">Diretur</th>
            </>
          ) : (
            <th className="w-[100px] px-2 py-3 text-center font-semibold">Stall</th>
          )}
          <th className={`${variant === "create" ? "w-[96px]" : "w-[88px]"} px-2 py-3 text-center font-semibold`}>Tersedia</th>
          <th className="w-[112px] px-2 py-3 text-center font-semibold">
            Qty Retur
          </th>
          <th className="min-w-[140px] px-3 py-3 text-left font-semibold">
            Kondisi
          </th>
        </tr>
      </thead>
      <tbody>
        {returnableItems.map((item) => {
          const itemDisplay = itemName(item);
          return (
          <tr
            key={item.grn_item_id}
            className={`bg-white ${item.selected ? "bg-pink-50/40" : "hover:bg-gray-50/80"}`}
          >
            <td className="px-2 py-3 text-center align-middle">
              <Checkbox
                checked={item.selected}
                onCheckedChange={() => onToggle(item.grn_item_id)}
                aria-label={`Pilih ${itemDisplay.nama}`}
              />
            </td>
            <td className="px-4 py-3 align-top">
              <div className="font-medium text-gray-900">
                {itemDisplay.nama}
              </div>
              <div className="mt-0.5 text-xs text-gray-500">
                {itemDisplay.kode}
              </div>
            </td>
            {variant === "create" ? (
              <>
                <td className="px-2 py-3 text-center align-middle text-gray-700">
                  {formatNumber(item.qty_diterima, 4)}
                </td>
                <td className="px-2 py-3 text-center align-middle text-gray-500">
                  {formatNumber(item.qty_returned, 4)}
                </td>
              </>
            ) : (
              <td className="px-2 py-3 text-center align-middle text-xs text-gray-600">
                {item.warehouse_name || "-"}
              </td>
            )}
            <td className="px-2 py-3 text-center align-middle font-semibold text-pink-700">
              {formatNumber(item.qty_available_to_return, 4)}
            </td>
            <td className="px-1.5 py-1.5 align-middle">
              <NumericInput
                min={0}
                max={item.qty_available_to_return}
                value={item.selected ? item.qty_return : 0}
                onValueChange={(value) =>
                  onQtyChange(item.grn_item_id, value || 0)
                }
                decimalScale={4}
                disabled={!item.selected}
                className="h-9 w-full border-gray-200/80 bg-white px-2 text-center text-sm focus-visible:border-pink-300 focus-visible:ring-1 focus-visible:ring-pink-200/80 disabled:bg-gray-50"
              />
            </td>
            <td className="px-1.5 py-1.5 align-middle">
              <input
                type="text"
                value={item.condition_notes}
                onChange={(e) =>
                  onNotesChange(item.grn_item_id, e.target.value)
                }
                disabled={!item.selected}
                placeholder="Kondisi item..."
                className="h-9 w-full rounded-lg border border-gray-200/80 bg-white px-2 text-sm focus:border-pink-300 focus:outline-none focus:ring-1 focus:ring-pink-200/80 disabled:bg-gray-50"
              />
            </td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}
