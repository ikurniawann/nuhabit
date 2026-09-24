"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { OpnameCountList, type OpnameCountItem } from "@/features/inventory/opname-shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PurchasingFormHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { useProductStockOpname } from "../queries";
import {
  PRODUCT_STOCK_OPNAME_STATUS_COLORS,
  PRODUCT_STOCK_OPNAME_STATUS_LABELS,
} from "../types";

function formatQty(value: number | null | undefined) {
  return Number(value || 0).toLocaleString("id-ID", { maximumFractionDigits: 4 });
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatDateTime(dateStr?: string | null) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ProductStockOpnameDetailPageProps {
  id: string;
}

export function ProductStockOpnameDetailPage({ id }: ProductStockOpnameDetailPageProps) {
  const detailQuery = useProductStockOpname(id);
  const [search, setSearch] = useState("");

  const detail = detailQuery.data;

  const countItems = useMemo<OpnameCountItem[]>(
    () =>
      (detail?.lines ?? []).map((line) => ({
        key: line.id,
        code: line.product_kode ?? "",
        name: line.product_nama ?? "",
        subtitle: line.pos_sku_id ? `Varian: ${line.pos_sku_code || "—"} — ${line.pos_sku_name || "—"}` : null,
        unit: line.satuan || "—",
        qtySystem: line.qty_system,
        qtyInput: line.qty_counted === null || line.qty_counted === undefined ? "" : String(line.qty_counted),
        variance: line.qty_variance === null || line.qty_variance === undefined ? null : line.qty_variance,
      })),
    [detail?.lines]
  );

  const progress = useMemo(() => {
    const lines = detail?.lines ?? [];
    const counted = lines.filter(
      (line) => line.qty_counted !== null && line.qty_counted !== undefined
    ).length;
    const variance = lines.filter(
      (line) =>
        line.qty_variance !== null &&
        line.qty_variance !== undefined &&
        line.qty_variance !== 0
    ).length;
    return { counted, variance, total: lines.length };
  }, [detail?.lines]);

  if (detailQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
        Memuat riwayat stok opname produk...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-gray-500">Stok opname produk tidak ditemukan</p>
        <Link href={PRODUCT_ROUTES.inventoryOpname}>
          <Button variant="outline" className="purchasing-secondary-button">
            Kembali
          </Button>
        </Link>
      </div>
    );
  }

  const canContinue = detail.status === "draft" || detail.status === "in_progress";

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={PRODUCT_ROUTES.inventoryOpname}
        title={detail.opname_number}
        description={
          <>
            Riwayat stok opname produk · {formatDate(detail.opname_date)}
            {detail.warehouse?.name ? (
              <>
                {" "}
                · Stall: {detail.warehouse.name}
              </>
            ) : null}
          </>
        }
        actions={
          canContinue ? (
            <Link href={PRODUCT_ROUTES.inventoryOpnameContinue(detail.id)}>
              <Button className="purchasing-main-button w-full sm:w-auto">
                Lanjutkan Perhitungan
              </Button>
            </Link>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={PRODUCT_STOCK_OPNAME_STATUS_COLORS[detail.status]}>
          {PRODUCT_STOCK_OPNAME_STATUS_LABELS[detail.status]}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Total Baris</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{progress.total}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Terhitung</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{progress.counted}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Ada Selisih</p>
            <p className="mt-1 text-2xl font-bold text-pink-600">{progress.variance}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Status</p>
            <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-gray-800">
              {detail.status === "completed" && (
                <CheckCircleIcon className="h-5 w-5 text-emerald-600" />
              )}
              {PRODUCT_STOCK_OPNAME_STATUS_LABELS[detail.status]}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-gray-200/70 shadow-xs">
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-gray-200/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Baris Produk</h2>
              <p className="text-sm text-gray-500">
                Hasil perhitungan stok fisik (hanya baca)
              </p>
            </div>
          </div>

          <div className="px-4 pb-4">
            <OpnameCountList
              items={countItems}
              nameLabel="Nama Produk"
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Cari produk..."
              readOnly
              emptyText="Tidak ada baris"
            />
          </div>
        </CardContent>
      </Card>

      {detail.notes && (
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Catatan</p>
            <p className="mt-1 text-sm text-gray-700">{detail.notes}</p>
          </CardContent>
        </Card>
      )}

      {detail.status === "completed" && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200/80 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircleIcon className="h-5 w-5 shrink-0" />
          Stok opname produk selesai
          {detail.completed_at ? ` pada ${formatDateTime(detail.completed_at)}` : ""}. Selisih
          stok telah diposting ke persediaan.
        </div>
      )}

      {detail.status === "cancelled" && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-800">
          <XMarkIcon className="h-5 w-5 shrink-0" />
          Sesi stok opname produk ini telah dibatalkan.
        </div>
      )}

      {canContinue && (
        <div className="rounded-lg border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Sesi ini masih berstatus draf. Gunakan tombol{" "}
          <span className="font-medium">Lanjutkan Perhitungan</span> untuk melanjutkan
          perhitungan di halaman opname.
        </div>
      )}
    </div>
  );
}
