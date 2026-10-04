"use client";

import Link from "next/link";
import { Calculator, Eye, Loader2, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { formatNumber } from "@/lib/format";
import { PRODUCT_ROUTES } from "@/lib/purchasing/item-routes";
import type { ProductWithCOGS } from "@/types/purchasing";
import { getProductUnitLabel } from "../product-unit";

interface ProductsTableProps {
  products: ProductWithCOGS[];
  categoryLabel: (code?: string | null) => string;
  statusUpdatingId: string | null;
  /** Produk yang sedang di-update HPP-nya; null bila tidak ada. */
  applyingHppId: string | null;
  onToggleStatus: (product: ProductWithCOGS, nextStatus: boolean) => void;
  onApplyHpp: (product: ProductWithCOGS) => void;
  onDelete: (product: ProductWithCOGS) => void;
}

export function ProductsTable({
  products,
  categoryLabel,
  statusUpdatingId,
  applyingHppId,
  onToggleStatus,
  onApplyHpp,
  onDelete,
}: ProductsTableProps) {
  return (
  <div className="overflow-x-auto">
    <table className="min-w-full text-sm">
      <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
        <tr>
          <th className="px-4 py-3 text-left font-semibold">Kode</th>
          <th className="px-4 py-3 text-left font-semibold">Nama Produk</th>
          <th className="px-4 py-3 text-left font-semibold">Stall</th>
          <th className="px-4 py-3 text-left font-semibold">Kategori</th>
          <th className="px-4 py-3 text-left font-semibold">Satuan</th>
          <th className="px-4 py-3 text-right font-semibold">HPP Saat Ini</th>
          <th className="px-4 py-3 text-right font-semibold">HPP Seharusnya</th>
          <th className="px-4 py-3 text-right font-semibold">Harga Jual</th>
          <th className="px-4 py-3 text-center font-semibold">Aktif</th>
          <th className="px-4 py-3 text-right font-semibold">Aksi</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {products.map((product) => (
          <tr key={product.id} className="hover:bg-gray-50">
            <td className="px-4 py-3">
              <span className="font-medium text-gray-900">
                {product.kode_produk || product.kode || "-"}
              </span>
            </td>
            <td className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={PRODUCT_ROUTES.productsDetail(product.id)}
                  className="font-medium text-pink-700 hover:underline"
                >
                  {product.nama}
                </Link>
                {product.hpp_perlu_review ? (
                  <Badge
                    variant="outline"
                    className="border-amber-200/80 bg-amber-50 text-amber-800"
                  >
                    Perlu update
                  </Badge>
                ) : null}
                {/* EPIC-047 Fase 1A — badge varian SKU POS merchandise tertaut */}
                {(product.variant_count ?? 0) > 0 ? (
                  <Badge
                    variant="outline"
                    className="border-indigo-200/80 bg-indigo-50 text-indigo-700"
                  >
                    {product.variant_count} varian
                  </Badge>
                ) : null}
              </div>
            </td>
            <td className="px-4 py-3 text-gray-700">{product.warehouse_name || product.warehouse_code || "-"}</td>
            <td className="px-4 py-3 text-gray-700">
              {categoryLabel(product.kategori)}
            </td>
            <td className="px-4 py-3 text-gray-700">{getProductUnitLabel(product)}</td>
            <td className="px-4 py-3 text-right font-medium text-gray-900">
              {formatNumber(product.hpp_tersimpan ?? product.harga_modal ?? 0)}
            </td>
            <td className="px-4 py-3 text-right font-medium text-pink-700">
              {formatNumber(product.hpp_resep ?? product.hpp_estimasi ?? 0)}
            </td>
            <td className="px-4 py-3 text-right font-medium text-gray-900">
              {formatNumber(product.harga_jual || 0)}
            </td>
            <td className="px-4 py-3 text-center">
              <div className="flex items-center justify-center">
                <Switch
                  checked={product.is_active ?? true}
                  disabled={statusUpdatingId === product.id}
                  onCheckedChange={(checked) => onToggleStatus(product, checked)}
                  aria-label={`Ubah status aktif ${product.nama}`}
                />
              </div>
            </td>
            <td className="px-4 py-3 text-right">
              <div className="flex items-center justify-end gap-1">
                <Link href={PRODUCT_ROUTES.productsDetail(product.id)}>
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Lihat detail"
                    className="cursor-pointer"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href={PRODUCT_ROUTES.productsEdit(product.id)}>
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Ubah produk"
                    className="cursor-pointer"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href={PRODUCT_ROUTES.productsBom(product.id)}>
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Ubah resep (BOM)"
                    className="cursor-pointer"
                  >
                    <Calculator className="h-4 w-4 text-pink-600" />
                  </Button>
                </Link>
                {product.hpp_perlu_review ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Update ke HPP seharusnya"
                    className="cursor-pointer text-amber-700 hover:text-amber-800"
                    disabled={applyingHppId !== null}
                    onClick={() => onApplyHpp(product)}
                  >
                    {applyingHppId === product.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  title="Hapus produk"
                  className="cursor-pointer text-red-500 hover:text-red-600"
                  onClick={() => onDelete(product)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
  );
}
