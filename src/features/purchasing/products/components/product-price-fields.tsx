"use client";

import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { formatNumber } from "@/lib/format";

const mutedGroupClass =
  "flex rounded-lg border border-gray-200/70 bg-muted/50";
const inputGroupClass =
  "flex rounded-lg border border-gray-200/70 bg-card focus-within:border-border focus-within:ring-1 focus-within:ring-primary/30";

type ProductPriceFieldsProps = {
  totalCost: number;
  markupPersen?: number;
  hargaJual?: number;
  onHargaJualChange: (value: number) => void;
};

export function ProductPriceFields({
  totalCost,
  markupPersen = 0,
  hargaJual = 0,
  onHargaJualChange,
}: ProductPriceFieldsProps) {
  const margin = (hargaJual || 0) - (totalCost || 0);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="harga_modal" className="text-xs">
          Estimasi HPP
        </Label>
        <div className={mutedGroupClass}>
          <NumericInput
            id="harga_modal"
            value={totalCost}
            onValueChange={() => undefined}
            decimalScale={0}
            disabled
            className="h-9 border-0 bg-transparent text-sm font-mono shadow-none focus-visible:ring-0"
          />
        </div>
        <p className="text-xs text-muted-foreground">Dihitung dari resep (BOM)</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="markup" className="text-xs">
          Markup
        </Label>
        <div className={mutedGroupClass}>
          <NumericInput
            id="markup"
            value={markupPersen}
            onValueChange={() => undefined}
            decimalScale={2}
            disabled
            className="h-9 rounded-r-none border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
          />
          <div className="flex min-w-12 items-center justify-center rounded-r-lg border-l border-gray-200/70 px-3 text-xs font-semibold text-muted-foreground">
            %
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Otomatis dari harga jual vs HPP</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="harga_jual" className="text-xs">
          Harga Jual
        </Label>
        <div className={inputGroupClass}>
          <NumericInput
            id="harga_jual"
            value={hargaJual}
            onValueChange={onHargaJualChange}
            decimalScale={0}
            placeholder="Harga ke pelanggan"
            className="h-9 border-0 text-sm font-mono shadow-none focus-visible:ring-0"
          />
        </div>
        <p className="text-xs text-muted-foreground">Bisa diisi manual</p>
      </div>

      <div className="flex items-center justify-between border-t border-gray-200/70 pt-3 text-sm">
        <span className="text-muted-foreground">Margin</span>
        <span className={`font-medium ${margin < 0 ? "text-amber-700" : "text-foreground"}`}>
          {formatNumber(margin)}
        </span>
      </div>
    </div>
  );
}
