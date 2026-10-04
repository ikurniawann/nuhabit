"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { formatRupiah } from "@/lib/format";
import type { POItemForm } from "@/lib/purchasing/po-form-items";
import type { PoTotals } from "@/lib/purchasing/po-totals";

export interface PRSource {
  id: string;
  pr_number: string;
  badge: string;
  badgeClass: string;
  detail?: string;
}

export function PRSourceCard({ pr, onOpen }: { pr: PRSource; onOpen: () => void }) {
  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Sumber Purchase Request</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{pr.pr_number}</span>
              <Badge className={pr.badgeClass}>{pr.badge}</Badge>
            </div>
            {pr.detail && <p className="text-sm text-muted-foreground">{pr.detail}</p>}
          </div>
          <Button type="button" variant="outline" onClick={onOpen}>
            Lihat Purchase Request
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PercentInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex rounded-lg border border-gray-200/80 bg-white focus-within:border-gray-300 focus-within:ring-1 focus-within:ring-gray-200">
        <NumericInput
          min="0"
          max="100"
          value={value}
          decimalScale={2}
          onValueChange={(next) => onChange(Math.min(100, Math.max(0, next || 0)))}
          className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
        />
        <div className="flex min-w-10 items-center justify-center rounded-r-lg border-l border-gray-200/80 bg-gray-50 px-3 text-xs font-medium text-gray-500">
          %
        </div>
      </div>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{formatRupiah(value)}</span>
    </div>
  );
}

interface POSummaryCardProps {
  totals: PoTotals;
  diskonPersen: number;
  ppnPersen: number;
  onDiskonChange: (value: number) => void;
  onPpnChange: (value: number) => void;
}

export function POSummaryCard({ totals, diskonPersen, ppnPersen, onDiskonChange, onPpnChange }: POSummaryCardProps) {
  return (
    <Card className="border-gray-200/70 shadow-xs xl:col-span-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Ringkasan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <TotalRow label="Subtotal" value={totals.subtotal} />
        <TotalRow label="Diskon" value={totals.diskon_nominal} />
        <TotalRow label={`PPN (${ppnPersen}%)`} value={totals.ppn_nominal} />
        <div className="flex justify-between border-t border-gray-200/70 pt-3 text-lg font-semibold text-gray-900">
          <span>Total</span>
          <span>{formatRupiah(totals.total)}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 border-t border-gray-200/70 pt-4 sm:grid-cols-2 xl:grid-cols-1">
          <PercentInput label="Diskon (%)" value={diskonPersen} onChange={onDiskonChange} />
          <PercentInput label="PPN (%)" value={ppnPersen} onChange={onPpnChange} />
        </div>
      </CardContent>
    </Card>
  );
}

interface POItemsSectionProps {
  items: POItemForm[];
  locked: boolean;
  onChange: (index: number, field: "qty_ordered" | "harga_satuan", value: number) => void;
}

/** Item PO dari purchase request: bahan baku & satuan mengikuti PR, qty dan harga bisa disesuaikan. */
export function POItemsSection({ items, locked, onChange }: POItemsSectionProps) {
  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Item Purchase Order</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item, index) => (
          <div key={item.id} className="rounded-xl border border-gray-200/70 bg-white/70 p-4">
            <p className="mb-4 border-b border-gray-200/70 pb-3 text-sm font-medium text-gray-900">Item #{index + 1}</p>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <ReadOnlyField className="lg:col-span-4" label="Bahan Baku" value={item.raw_material_name} />
              <div className="min-w-0 space-y-1.5 lg:col-span-2">
                <Label className="text-xs">Qty</Label>
                <NumericInput
                  min="0"
                  value={item.qty_ordered > 0 ? item.qty_ordered : null}
                  decimalScale={4}
                  placeholder="0"
                  disabled={locked}
                  onFocus={(event) => event.currentTarget.select()}
                  onValueChange={(value) => onChange(index, "qty_ordered", value || 0)}
                  className="h-9 text-sm"
                />
              </div>
              <ReadOnlyField className="lg:col-span-2" label="Satuan" value={item.raw_material_unit} />
              <div className="min-w-0 space-y-1.5 lg:col-span-2">
                <Label className="text-xs">Harga Satuan</Label>
                <NumericInput
                  min="0"
                  value={item.harga_satuan}
                  decimalScale={0}
                  disabled={locked}
                  onValueChange={(value) => onChange(index, "harga_satuan", value || 0)}
                  className="h-9 text-sm"
                />
              </div>
              <div className="min-w-0 rounded-lg bg-gray-50/80 p-3 lg:col-span-2">
                <p className="text-xs text-gray-500">Subtotal</p>
                <p className="text-sm font-semibold text-gray-900">{formatRupiah(item.subtotal)}</p>
              </div>
            </div>
          </div>
        ))}

        {items.length === 0 && (
          <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 py-10 text-center text-sm text-gray-500">
            Belum ada item dari purchase request.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReadOnlyField({ label, value, className }: { label: string; value?: string; className: string }) {
  return (
    <div className={`min-w-0 space-y-1.5 ${className}`}>
      <Label className="text-xs">{label}</Label>
      <div className="flex h-9 items-center truncate rounded-lg border border-gray-200/80 bg-gray-50 px-2.5 text-sm">
        {value || "-"}
      </div>
    </div>
  );
}
