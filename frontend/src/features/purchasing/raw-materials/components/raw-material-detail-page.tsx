"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ITEMS_RAW_MATERIALS_PATH } from "@/lib/purchasing/item-routes";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import {
  AlertCircle,
  Edit,
  Trash2,
  Boxes,
  Banknote,
  Settings2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  useRawMaterial,
  useRawMaterialCategoryOptions,
} from "../queries";
import { useDeleteRawMaterial } from "../mutations";
import {
  buildLookupLabelMap,
  resolveCategoryLabel,
} from "../master-lookups";
import { baseToLargeUnit, getRawMaterialUnitInfo, largeToBaseUnit } from "../unit-math";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatNumber } from "@/lib/format";
import { RawMaterialConversionsTab } from "./raw-material-conversions-tab";
import { RawMaterialPriceHistoryTab } from "./raw-material-price-history-tab";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const STOCK_STATUS_STYLES: Record<string, string> = {
  AMAN: "border-emerald-200 bg-emerald-50 text-emerald-700",
  MENIPIS: "border-amber-200 bg-amber-50 text-amber-700",
  HABIS: "border-red-200 bg-red-50 text-red-700",
};

const STOCK_STATUS_LABELS: Record<string, string> = {
  AMAN: "Aman",
  MENIPIS: "Stok Menipis",
  HABIS: "Stok Habis",
};

export function RawMaterialDetailPage() {
  const params = useParams();
  const router = useRouter();
  const materialId = params.id as string;

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const materialQuery = useRawMaterial(materialId);
  const categoriesQuery = useRawMaterialCategoryOptions();
  const categoryMap = buildLookupLabelMap(categoriesQuery.data);
  const material = materialQuery.data ?? null;
  const loading = materialQuery.isLoading;
  const deleteMutation = useDeleteRawMaterial();

  const handleDelete = async () => {
    if (!material || deleteMutation.isPending) return;
    try {
      await deleteMutation.mutateAsync(material.id);
      toast.success("Bahan baku berhasil dihapus");
      setIsDeleteDialogOpen(false);
      router.push(ITEMS_RAW_MATERIALS_PATH);
    } catch (error: unknown) {
      console.error("Error deleting material:", error);
      toast.error(getErrorMessage(error, "Gagal menghapus bahan baku"));
    }
  };

  const getStockStatusBadge = (status: string) => {
    const normalized = status || "AMAN";
    return (
      <Badge variant="outline" className={STOCK_STATUS_STYLES[normalized] || STOCK_STATUS_STYLES.AMAN}>
        {normalized === "MENIPIS" || normalized === "HABIS" ? (
          <AlertCircle className="mr-1 inline h-3 w-3" />
        ) : null}
        {STOCK_STATUS_LABELS[normalized] || normalized}
      </Badge>
    );
  };

  const getCategoryLabel = (category?: string) =>
    resolveCategoryLabel(category, categoryMap);

  const unitInfo = getRawMaterialUnitInfo(material ?? {});
  const satuanBesarName = unitInfo.largeUnitName;
  const satuanKecilName = unitInfo.smallUnitName;
  const baseUnitName = unitInfo.baseUnitName;
  const konversiFactor = unitInfo.konversiFactor;

  const qtyOnHandBase = Number(material?.qty_onhand || 0);
  const qtyReservedBase = Number(material?.qty_reserved || 0);
  const qtyOnOrderBase = Number(material?.qty_on_order || 0);
  const stokMinimumLarge = Number(material?.stok_minimum || 0);
  const stokMaximumLarge = Number(material?.stok_maximum || 0);
  const avgCostBase = Number(material?.avg_cost || 0);
  const hargaBeliLarge = Number(material?.harga_beli || 0);

  /** Shows the equivalent quantity in the other unit when a small unit exists. */
  const renderUnitEquivalent = (label: string) =>
    unitInfo.hasSmallUnit ? (
      <p className="mt-0.5 text-xs text-gray-500">{label}</p>
    ) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
        Memuat bahan baku...
      </div>
    );
  }

  if (!material) {
    return (
      <div className="py-16 text-center text-red-500">Bahan baku tidak ditemukan</div>
    );
  }

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title={material.nama}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700">{material.kode}</span>
            <span className="text-gray-300">•</span>
            <span>{getCategoryLabel(material.kategori)}</span>
            <span className="text-gray-300">•</span>
            <span>{satuanBesarName}</span>
            <span className="ml-1">{getStockStatusBadge(material.status_stok || "")}</span>
          </span>
        }
        actions={
          <>
            <Link href={`${ITEMS_RAW_MATERIALS_PATH}/edit/${material.id}`}>
              <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
                <Edit className="mr-2 h-4 w-4" />
                Ubah
              </Button>
            </Link>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(true)}
              className="h-10 w-full rounded-lg border-red-200/80 bg-white px-3 text-sm font-medium text-red-600 shadow-sm hover:!border-red-200 hover:!bg-red-50 hover:!text-red-700 sm:w-auto"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Hapus
            </Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-pink-50 text-pink-600">
                <Boxes className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Stok Tersedia</p>
                <p className="text-lg font-bold text-gray-900">
                  {formatNumber(qtyOnHandBase, 4)} {baseUnitName}
                </p>
                {renderUnitEquivalent(
                  `≈ ${formatNumber(baseToLargeUnit(qtyOnHandBase, konversiFactor), 4)} ${satuanBesarName}`
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                <AlertCircle className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Stok Minimum</p>
                <p className="text-lg font-bold text-gray-900">
                  {formatNumber(stokMinimumLarge, 4)} {satuanBesarName}
                </p>
                {renderUnitEquivalent(
                  `= ${formatNumber(largeToBaseUnit(stokMinimumLarge, konversiFactor), 4)} ${baseUnitName}`
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Settings2 className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Stok Maksimum</p>
                <p className="text-lg font-bold text-gray-900">
                  {formatNumber(stokMaximumLarge, 4)} {satuanBesarName}
                </p>
                {renderUnitEquivalent(
                  `= ${formatNumber(largeToBaseUnit(stokMaximumLarge, konversiFactor), 4)} ${baseUnitName}`
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <Banknote className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Harga Rata-rata</p>
                <p className="text-lg font-bold text-gray-900">
                  {avgCostBase > 0 ? `${formatNumber(avgCostBase)} / ${baseUnitName}` : "-"}
                </p>
                {avgCostBase > 0
                  ? renderUnitEquivalent(
                      `≈ ${formatNumber(avgCostBase * konversiFactor)} / ${satuanBesarName}`
                    )
                  : null}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="info" className="flex-col space-y-4">
        <TabsList
          variant="line"
          className="flex h-auto w-full justify-start gap-6 rounded-none border-b border-gray-200/70 bg-transparent p-0"
        >
          <TabsTrigger
            value="info"
            className="h-11 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 text-sm font-semibold text-gray-500 shadow-none data-active:border-pink-600 data-active:!bg-transparent data-active:text-pink-700 data-active:shadow-none"
          >
            Informasi
          </TabsTrigger>
          <TabsTrigger
            value="stock"
            className="h-11 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 text-sm font-semibold text-gray-500 shadow-none data-active:border-pink-600 data-active:!bg-transparent data-active:text-pink-700 data-active:shadow-none"
          >
            Stok &amp; Harga
          </TabsTrigger>
          <TabsTrigger
            value="prices"
            className="h-11 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 text-sm font-semibold text-gray-500 shadow-none data-active:border-pink-600 data-active:!bg-transparent data-active:text-pink-700 data-active:shadow-none"
          >
            Harga &amp; Riwayat
          </TabsTrigger>
          <TabsTrigger
            value="conversions"
            className="h-11 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 text-sm font-semibold text-gray-500 shadow-none data-active:border-pink-600 data-active:!bg-transparent data-active:text-pink-700 data-active:shadow-none"
          >
            Konversi Satuan
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="border-gray-200/70 shadow-xs lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Informasi Bahan Baku</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Kode</p>
                    <p className="font-medium text-gray-900">{material.kode}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Kategori</p>
                    <p className="font-medium text-gray-900">{getCategoryLabel(material.kategori)}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Deskripsi</p>
                  <p className="text-gray-900">{material.deskripsi || "-"}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Satuan Besar</p>
                    <p className="font-medium text-gray-900">{satuanBesarName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Satuan Kecil</p>
                    <p className="font-medium text-gray-900">{satuanKecilName}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Konversi</p>
                    <p className="font-medium text-gray-900">
                      {material.satuan_kecil_id
                        ? `1 ${satuanBesarName} = ${formatNumber(material.konversi_factor || 1, 4)} ${satuanKecilName}`
                        : "Tanpa konversi"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Satuan Dasar Stok</p>
                    <p className="font-medium text-gray-900">{baseUnitName}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Stok dan harga rata-rata dicatat dalam satuan ini.
                    </p>
                  </div>
                </div>
                {material.shelf_life_days && (
                  <div>
                    <p className="text-sm text-gray-500">Masa Simpan</p>
                    <p className="font-medium text-gray-900">{material.shelf_life_days} hari</p>
                  </div>
                )}
                {(material.coa_production || material.coa_rnd || material.coa_asset) && (
                  <div className="border-t border-gray-200/70 pt-4">
                    <p className="mb-2 text-sm text-gray-500">Chart of Accounts</p>
                    <div className="flex flex-wrap gap-2">
                      {material.coa_production && (
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                          Produksi: {material.coa_production}
                        </Badge>
                      )}
                      {material.coa_rnd && (
                        <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
                          Riset &amp; Pengembangan: {material.coa_rnd}
                        </Badge>
                      )}
                      {material.coa_asset && (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                          Aset: {material.coa_asset}
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Pengaturan Stok</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-gray-500">Minimum</span>
                  <span className="text-right font-medium text-gray-900">
                    {formatNumber(stokMinimumLarge, 4)} {satuanBesarName}
                    {unitInfo.hasSmallUnit && (
                      <span className="block text-xs font-normal text-gray-500">
                        = {formatNumber(largeToBaseUnit(stokMinimumLarge, konversiFactor), 4)} {baseUnitName}
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Maksimum</span>
                  <span className="text-right font-medium text-gray-900">
                    {formatNumber(stokMaximumLarge, 4)} {satuanBesarName}
                    {unitInfo.hasSmallUnit && (
                      <span className="block text-xs font-normal text-gray-500">
                        = {formatNumber(largeToBaseUnit(stokMaximumLarge, konversiFactor), 4)} {baseUnitName}
                      </span>
                    )}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="stock">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Stok &amp; Harga Terkini</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <p className="text-sm text-gray-500">Stok Tersedia</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {formatNumber(qtyOnHandBase, 4)} {baseUnitName}
                  </p>
                  {renderUnitEquivalent(
                    `≈ ${formatNumber(baseToLargeUnit(qtyOnHandBase, konversiFactor), 4)} ${satuanBesarName}`
                  )}
                </div>
                <div>
                  <p className="text-sm text-gray-500">Stok Dipesan</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {formatNumber(qtyReservedBase, 4)} {baseUnitName}
                  </p>
                  {renderUnitEquivalent(
                    `≈ ${formatNumber(baseToLargeUnit(qtyReservedBase, konversiFactor), 4)} ${satuanBesarName}`
                  )}
                </div>
                <div>
                  <p className="text-sm text-gray-500">Stok Dalam Pemesanan</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {formatNumber(qtyOnOrderBase, 4)} {baseUnitName}
                  </p>
                  {renderUnitEquivalent(
                    `≈ ${formatNumber(baseToLargeUnit(qtyOnOrderBase, konversiFactor), 4)} ${satuanBesarName}`
                  )}
                </div>
              </div>
              <div className="space-y-3 border-t border-gray-200/70 pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Harga Rata-rata</span>
                  <span className="text-right text-xl font-semibold text-gray-900">
                    {avgCostBase > 0 ? `${formatNumber(avgCostBase)} / ${baseUnitName}` : "-"}
                    {avgCostBase > 0 && unitInfo.hasSmallUnit && (
                      <span className="block text-xs font-normal text-gray-500">
                        ≈ {formatNumber(avgCostBase * konversiFactor)} / {satuanBesarName}
                      </span>
                    )}
                  </span>
                </div>
                {hargaBeliLarge > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Harga Beli Acuan</span>
                    <span className="text-right text-lg font-medium text-gray-900">
                      {formatNumber(hargaBeliLarge)} / {satuanBesarName}
                      {unitInfo.hasSmallUnit && (
                        <span className="block text-xs font-normal text-gray-500">
                          = {formatNumber(hargaBeliLarge / konversiFactor)} / {baseUnitName}
                        </span>
                      )}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Nilai Persediaan</span>
                  <span className="text-lg font-medium text-gray-900">
                    {formatNumber(qtyOnHandBase * avgCostBase)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prices" className="space-y-4">
          <RawMaterialPriceHistoryTab materialId={material.id} baseUnitName={baseUnitName} />
        </TabsContent>

        <TabsContent value="conversions" className="space-y-4">
          <RawMaterialConversionsTab
            material={material}
            satuanBesarName={satuanBesarName}
            satuanKecilName={satuanKecilName}
          />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title="Hapus Bahan Baku?"
        description={`Yakin ingin menghapus "${material.nama}"? Data akan disembunyikan dari daftar. Bahan yang masih punya stok atau dipakai di Bill of Materials tidak dapat dihapus.`}
        confirmLabel="Hapus"
        cancelLabel="Batal"
        loadingLabel="Menghapus..."
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
