"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { formatNumber, formatRupiah } from "@/lib/format";
import type { RecipeOwner } from "@/lib/purchasing/production-recipe-settings";
import { flattenBomTree, parseExplodeQty, type BomExplosion } from "@/lib/purchasing/production-ui-explode";
import { useBomExplosion } from "../queries";

interface BomExplodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owner: RecipeOwner;
  itemName: string;
}

/** Urai resep bertingkat: komponen per tingkat, bahan beli yang dibutuhkan, dan biayanya. */
export function BomExplodeDialog({ open, onOpenChange, owner, itemName }: BomExplodeDialogProps) {
  const [qtyInput, setQtyInput] = useState("1");
  const [qty, setQty] = useState<number | null>(1);
  const query = useBomExplosion(owner, qty);
  const invalidQty = parseExplodeQty(qtyInput) === null;

  useEffect(() => {
    const timeout = window.setTimeout(() => setQty(parseExplodeQty(qtyInput)), 300);
    return () => window.clearTimeout(timeout);
  }, [qtyInput]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Urai Resep (BOM)</DialogTitle>
          <DialogDescription>
            Kebutuhan bahan {itemName} sampai bahan beli, dengan stok dan biaya saat ini.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5 sm:w-56">
          <Label htmlFor="bom-explode-qty" className="text-xs">
            Jumlah yang dibuat{query.data ? ` (${query.data.item.satuan})` : ""}
          </Label>
          <Input
            id="bom-explode-qty"
            inputMode="decimal"
            value={qtyInput}
            onChange={(event) => setQtyInput(event.target.value)}
            aria-invalid={invalidQty}
            className="h-9 text-sm"
          />
          {invalidQty && <p className="text-xs text-red-600">Jumlah harus lebih dari 0</p>}
        </div>

        {query.isLoading ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-pink-600" />
            Mengurai resep...
          </div>
        ) : query.isError ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {query.error instanceof Error ? query.error.message : "Gagal mengurai resep (BOM)"}
          </p>
        ) : query.data ? (
          <ExplosionView explosion={query.data} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200/70 bg-gray-50/60 p-3">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function ExplosionView({ explosion }: { explosion: BomExplosion }) {
  const rows = flattenBomTree(explosion.lines);
  const leaves = explosion.leaves ?? [];
  const shortLeaves = leaves.filter((leaf) => leaf.shortage_qty > 0).length;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryTile label="Jumlah" value={`${formatNumber(explosion.qty, 3)} ${explosion.item.satuan}`} />
        <SummaryTile label="Biaya dari stok" value={formatRupiah(explosion.stock_cost)} />
        <SummaryTile label="Biaya bila diproduksi" value={formatRupiah(explosion.rolled_cost)} />
        <SummaryTile label="Kedalaman resep" value={`${explosion.depth} tingkat`} />
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-900">Struktur Resep</h3>
        <ScrollRegion label="Struktur resep" className="overflow-x-auto rounded-xl border border-gray-200/70">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Bahan</th>
                <th className="px-4 py-3 text-right font-semibold whitespace-nowrap">Per Induk</th>
                <th className="px-4 py-3 text-right font-semibold whitespace-nowrap">Dibutuhkan</th>
                <th className="px-4 py-3 text-right font-semibold">Stok</th>
                <th className="px-4 py-3 text-right font-semibold">Kurang</th>
                <th className="px-4 py-3 text-right font-semibold">Biaya</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.key} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5" style={{ paddingLeft: `${1 + (row.level - 1) * 1.25}rem` }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900">{row.nama}</span>
                      {row.has_recipe && (
                        <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                          Diproduksi
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {row.kode}
                      {row.waste_factor > 0 ? ` · susut ${formatNumber(row.waste_factor * 100, 2)}%` : ""}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">
                    {formatNumber(row.qty_per_parent, 4)} {row.satuan}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-900 whitespace-nowrap">
                    {formatNumber(row.qty_required, 4)} {row.satuan}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{formatNumber(row.qty_onhand, 4)}</td>
                  <td className={`px-4 py-2.5 text-right ${row.shortage_qty > 0 ? "font-semibold text-red-600" : "text-gray-400"}`}>
                    {formatNumber(row.shortage_qty, 4)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-900">{formatRupiah(row.total_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Kebutuhan Bahan Beli</h3>
          <p className="text-xs text-gray-500">
            Bila semua bahan setengah jadi diproduksi, setelah dikurangi stoknya
            {shortLeaves > 0 ? ` · ${shortLeaves} bahan kurang` : ""}
          </p>
        </div>
        <ScrollRegion label="Kebutuhan bahan beli" className="overflow-x-auto rounded-xl border border-gray-200/70">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Bahan</th>
                <th className="px-4 py-3 text-right font-semibold">Dibutuhkan</th>
                <th className="px-4 py-3 text-right font-semibold">Stok</th>
                <th className="px-4 py-3 text-right font-semibold">Kurang</th>
                <th className="px-4 py-3 text-right font-semibold">Biaya</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {leaves.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-500">
                    Tidak ada bahan beli yang perlu disiapkan.
                  </td>
                </tr>
              ) : (
                leaves.map((leaf) => (
                  <tr key={leaf.raw_material_id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-900">{leaf.nama}</p>
                      <p className="text-xs text-gray-500">{leaf.kode}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-gray-900 whitespace-nowrap">
                      {formatNumber(leaf.qty_required, 4)} {leaf.satuan}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700">{formatNumber(leaf.qty_onhand, 4)}</td>
                    <td className={`px-4 py-2.5 text-right ${leaf.shortage_qty > 0 ? "font-semibold text-red-600" : "text-gray-400"}`}>
                      {formatNumber(leaf.shortage_qty, 4)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-900">{formatRupiah(leaf.total_cost)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollRegion>
      </section>
    </div>
  );
}
