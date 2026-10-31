"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { NumericInput } from "@/components/ui/numeric-input";
import {
  DocumentItemsTable,
  DocumentLineInput,
  documentLineClass,
  type DocumentColumn,
} from "@/features/documents";
import { formatNumber, formatRupiah } from "@/lib/format";
import { itemLineTotal, type CatalogProduct, type QuotationItemForm } from "../types";

const COLUMNS: DocumentColumn[] = [
  { label: "No", className: "w-10" },
  { label: "Deskripsi / Produk" },
  { label: "Qty", className: "w-24 text-right" },
  { label: "Harga", className: "w-44 text-right" },
  { label: "Jumlah", className: "w-36 text-right" },
];

const ACTION_COLUMN: DocumentColumn = { label: "Aksi", className: "w-10", srOnly: true };

const toNumber = (value: string) => (value === "" ? null : Number(value));

/** Baris item quotation di atas kertas: isian bergaris, atau teks saat hanya-baca. */
export function QuotationItemsTable({
  items,
  products,
  readOnly,
  onChange,
  onPickProduct,
  onRemove,
}: {
  items: QuotationItemForm[];
  products: CatalogProduct[];
  readOnly: boolean;
  onChange: (index: number, patch: Partial<QuotationItemForm>) => void;
  onPickProduct: (index: number, productId: string) => void;
  onRemove: (index: number) => void;
}) {
  const productOptions = products.map((product) => ({
    value: product.id,
    label: product.name,
    description: Number(product.base_price) > 0 ? formatRupiah(product.base_price) : undefined,
  }));

  return (
    <DocumentItemsTable label="Daftar item quotation" columns={readOnly ? COLUMNS : [...COLUMNS, ACTION_COLUMN]}>
      {items.map((item, index) => {
        const row = index + 1;
        const isProduct = item.item_type === "produk";
        return (
          <tr key={index} className="align-top">
            <td className="px-2 py-2.5 text-muted-foreground tabular-nums">{row}</td>
            <td className="px-2 py-1.5">
              {readOnly ? (
                <p className="py-1">{item.description}</p>
              ) : isProduct ? (
                <Combobox
                  aria-label={`Produk baris ${row}`}
                  options={productOptions}
                  value={item.product_id}
                  onChange={(value) => onPickProduct(index, value)}
                  placeholder="Pilih produk katalog..."
                  searchPlaceholder="Cari produk..."
                  className={documentLineClass}
                />
              ) : (
                <DocumentLineInput
                  aria-label={`Deskripsi baris ${row}`}
                  value={item.description}
                  onChange={(e) => onChange(index, { description: e.target.value })}
                  placeholder="Deskripsi, mis. Sewa venue 4 jam"
                />
              )}
              <p className="px-1 text-[11px] text-muted-foreground">
                {isProduct ? "Produk katalog · per pax" : "Item bebas"}
              </p>
            </td>
            <td className="px-2 py-1.5 text-right">
              {readOnly ? (
                <p className="py-1 tabular-nums">
                  {formatNumber(item.qty, 2)}
                  {isProduct ? " pax" : ""}
                </p>
              ) : (
                <NumericInput
                  aria-label={`Qty baris ${row}`}
                  value={toNumber(item.qty)}
                  onValueChange={(value) => onChange(index, { qty: String(value) })}
                  decimalScale={2}
                  className={`${documentLineClass} text-right`}
                />
              )}
            </td>
            <td className="px-2 py-1.5 text-right">
              {readOnly ? (
                <p className="py-1 tabular-nums">{formatRupiah(item.unit_price)}</p>
              ) : (
                <NumericInput
                  aria-label={`Harga baris ${row}`}
                  value={toNumber(item.unit_price)}
                  onValueChange={(value) => onChange(index, { unit_price: String(value) })}
                  decimalScale={2}
                  prefix="Rp"
                  className={`${documentLineClass} pl-8 text-right`}
                />
              )}
            </td>
            <td className="px-2 py-2.5 text-right font-semibold tabular-nums">
              {formatRupiah(itemLineTotal(item))}
            </td>
            {readOnly ? null : (
              <td className="px-1 py-1.5 text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onRemove(index)}
                  disabled={items.length === 1}
                  aria-label={`Hapus baris ${row}`}
                  className="text-muted-foreground hover:text-danger"
                >
                  <Trash2 />
                </Button>
              </td>
            )}
          </tr>
        );
      })}
    </DocumentItemsTable>
  );
}
