import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import type { CreateGrnLine, CreateGrnLineEdit } from "@/lib/purchasing/grn-ui-lines";

const TH = "whitespace-nowrap border-b border-gray-200/70 px-3 py-3 font-semibold";

type Props = {
  lines: CreateGrnLine[];
  isProduct: boolean;
  onEdit: (poItemId: string, edit: CreateGrnLineEdit) => void;
};

/** Tabel konfirmasi qty diterima per item PO yang masih punya sisa. */
export function CreateGrnItemsTable({ lines, isProduct, onEdit }: Props) {
  return (
    <div className="px-4 pb-4 pt-3">
      <div className="overflow-x-auto rounded-xl border border-gray-200/70">
        <table className={`${isProduct ? "min-w-[720px]" : "min-w-[1040px]"} w-full border-collapse text-sm`}>
          <thead>
            <tr className="bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500">
              <th className="min-w-[180px] border-b border-r border-gray-200/70 px-4 py-3 text-left font-semibold">
                {isProduct ? "Produk" : "Bahan Baku"}
              </th>
              <th className={`${TH} border-r text-right`}>Dipesan</th>
              <th className={`${TH} border-r text-right`}>Sebelumnya</th>
              <th className={`${TH} border-r text-right`}>Sisa</th>
              <th className={`${TH} w-[18%] min-w-[160px] border-r text-center`}>Diterima / QC</th>
              {!isProduct && (
                <>
                  <th className={`${TH} min-w-[150px] border-r text-center`}>No. Batch</th>
                  <th className={`${TH} min-w-[160px] border-r text-center`}>Kedaluwarsa</th>
                </>
              )}
              <th className={`${TH} w-[18%] min-w-[160px] text-center`}>Tolak / QC Gagal</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const rowBorder = index === lines.length - 1 ? "" : "border-b border-gray-200/70";
              const cell = `border-r border-gray-200/70 px-3 align-middle ${rowBorder}`;
              return (
                <tr key={line.purchase_order_item_id} className="hover:bg-gray-50/80">
                  <td className={`border-r border-gray-200/70 px-4 py-3 align-top ${rowBorder}`}>
                    <div className="font-medium text-gray-900">{line.nama_bahan}</div>
                    {line.qty_ordered > 0 && (
                      <div className="mt-0.5 text-xs text-gray-500">
                        PO: {line.qty_ordered} {line.satuan}
                      </div>
                    )}
                  </td>
                  <td className={`${cell} py-3 text-right text-gray-700`}>{line.qty_ordered}</td>
                  <td className={`${cell} py-3 text-right text-gray-700`}>{line.qty_received}</td>
                  <td className={`${cell} py-3 text-right font-semibold text-brand-text`}>{line.remaining}</td>
                  <td className={`${cell} py-2`}>
                    <NumericInput
                      min="0"
                      max={line.remaining || undefined}
                      value={line.qty_diterima}
                      onValueChange={(value) => onEdit(line.purchase_order_item_id, { acceptQty: value || 0 })}
                      decimalScale={4}
                      className="h-10 w-full border-gray-200/80 bg-white px-3 text-center text-sm focus-visible:border-primary/40 focus-visible:ring-1 focus-visible:ring-primary/30"
                    />
                  </td>
                  {!isProduct && (
                    <>
                      <td className={`${cell} py-2`}>
                        <Input
                          value={line.batch_number}
                          onChange={(e) => onEdit(line.purchase_order_item_id, { batch_number: e.target.value })}
                          placeholder="LOT-..."
                          maxLength={100}
                          aria-label={`Nomor batch ${line.nama_bahan}`}
                          className="h-10 text-sm"
                        />
                      </td>
                      <td className={`${cell} py-2`}>
                        <Input
                          type="date"
                          value={line.expiry_date}
                          onChange={(e) => onEdit(line.purchase_order_item_id, { expiry_date: e.target.value })}
                          aria-label={`Tanggal kedaluwarsa ${line.nama_bahan}`}
                          className="h-10 text-sm"
                        />
                      </td>
                    </>
                  )}
                  <td className={`px-3 py-2 align-middle ${rowBorder}`}>
                    <div
                      className={`flex h-10 w-full items-center justify-center rounded-lg border border-gray-200/80 bg-gray-50 px-3 text-sm font-medium ${
                        line.qty_ditolak > 0 ? "text-red-600" : "text-gray-700"
                      }`}
                    >
                      {line.qty_ditolak}
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
