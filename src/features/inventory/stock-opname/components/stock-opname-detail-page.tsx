"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PurchasingFormHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import {
  toDisplayQty,
  type RawMaterialUnitInfo,
  type RawMaterialUnitMode,
} from "@/lib/inventory/raw-material-units";
import { RM_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { useStockOpname } from "../queries";
import {
  STOCK_OPNAME_STATUS_COLORS,
  STOCK_OPNAME_STATUS_LABELS,
  type StockOpnameLine,
} from "../types";
import { RawMaterialUnitSelect } from "./raw-material-unit-select";
import { OpnameCountList, type OpnameCountItem } from "@/features/inventory/opname-shared";

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

function lineUnitInfo(line: StockOpnameLine): RawMaterialUnitInfo {
  return {
    satuan: line.satuan,
    satuan_besar_nama: line.satuan_besar_nama ?? line.satuan,
    satuan_kecil_nama: line.satuan_kecil_nama,
    konversi_factor: line.konversi_factor,
  };
}

interface StockOpnameDetailPageProps {
  id: string;
}

export function StockOpnameDetailPage({ id }: StockOpnameDetailPageProps) {
  const detailQuery = useStockOpname(id);
  const [search, setSearch] = useState("");
  const [viewUnitByLine, setViewUnitByLine] = useState<
    Record<string, RawMaterialUnitMode>
  >({});

  const detail = detailQuery.data;

  useEffect(() => {
    if (!detail?.lines?.length) return;
    setViewUnitByLine((prev) => {
      const next = { ...prev };
      for (const line of detail.lines) {
        if (!next[line.id]) next[line.id] = "besar";
      }
      return next;
    });
  }, [detail?.lines]);

  const countItems = useMemo<OpnameCountItem[]>(
    () =>
      (detail?.lines ?? []).map((line) => {
        const unit = lineUnitInfo(line);
        const viewMode = viewUnitByLine[line.id] ?? "besar";
        const displaySystem = toDisplayQty(line.qty_system, viewMode, unit);
        const displayCounted =
          line.qty_counted === null || line.qty_counted === undefined ? null : toDisplayQty(line.qty_counted, viewMode, unit);
        const variance =
          displayCounted === null
            ? null
            : line.qty_variance !== null && line.qty_variance !== undefined
              ? toDisplayQty(line.qty_variance, viewMode, unit)
              : displayCounted - displaySystem;
        return {
          key: line.id,
          code: line.material_kode ?? "",
          name: line.material_nama ?? "",
          unit: (
            <RawMaterialUnitSelect
              info={unit}
              value={viewMode}
              onChange={(mode) => setViewUnitByLine((prev) => ({ ...prev, [line.id]: mode }))}
            />
          ),
          qtySystem: displaySystem,
          qtyInput: displayCounted === null ? "" : String(displayCounted),
          variance,
        };
      }),
    [detail?.lines, viewUnitByLine]
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
      <div className="py-16 text-center text-sm text-gray-400">
        Memuat riwayat stok opname...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-gray-500">Stok opname tidak ditemukan</p>
        <Link href={RM_ROUTES.inventoryOpname}>
          <Button variant="outline">Kembali</Button>
        </Link>
      </div>
    );
  }

  const canContinue =
    detail.status === "draft" || detail.status === "in_progress";

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={RM_ROUTES.inventoryOpname}
        title={detail.opname_number}
        description={`Riwayat stok opname · ${detail.warehouse?.name || "—"} · ${formatDate(detail.opname_date)}`}
        actions={
          canContinue ? (
            <Link href={RM_ROUTES.inventoryOpnameContinue(detail.id)}>
              <Button className="purchasing-main-button w-full sm:w-auto">
                Lanjutkan Perhitungan
              </Button>
            </Link>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={STOCK_OPNAME_STATUS_COLORS[detail.status]}
        >
          {STOCK_OPNAME_STATUS_LABELS[detail.status]}
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
              {STOCK_OPNAME_STATUS_LABELS[detail.status]}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-gray-200/70 shadow-xs">
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-gray-200/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Baris Bahan Baku</h2>
              <p className="text-sm text-gray-500">
                Hasil perhitungan stok fisik (hanya baca)
              </p>
            </div>
          </div>

          <div className="px-4 pb-4">
            <OpnameCountList
              items={countItems}
              nameLabel="Nama Bahan Baku"
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Cari bahan baku..."
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
          Stok opname selesai
          {detail.completed_at
            ? ` pada ${formatDateTime(detail.completed_at)}`
            : ""}
          . Selisih stok telah diposting ke persediaan.
        </div>
      )}

      {detail.status === "cancelled" && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-800">
          <XMarkIcon className="h-5 w-5 shrink-0" />
          Sesi stok opname ini telah dibatalkan.
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
