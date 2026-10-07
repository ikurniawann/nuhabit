"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useProductBomEditorData } from "../queries";
import { useCreateBOMItem, useUpdateBOMItem, useDeleteBOMItem } from "../mutations";
import { useParams, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PRODUCT_ROUTES } from "@/lib/purchasing/item-routes";
import { Combobox } from "@/components/ui/combobox";
import { NumericInput } from "@/components/ui/numeric-input";
import {
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  PurchasingFormHeader,
} from "@/features/purchasing/components/shared/purchasing-page-header";
import {
  BOMItem,
  RawMaterialWithStock,
} from "@/types/purchasing";
import { formatNumber } from "@/lib/format";
import { materialSmallUnitLabel, materialUnitCost } from "@/lib/purchasing/product-ui-form";

type BomDraft = {
  id: string;
  raw_material_id: string;
  qty_required: number;
  waste_factor: number;
  cost_per_unit: number;
  total_cost: number;
  persisted: boolean;
};

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function displayName(value?: string | null) {
  return (value || "-").replace(/\s+\d{8,}$/g, "").trim();
}

function mapBomItem(item: BOMItem): BomDraft {
  const qtyRequired = toNumber(item.qty_required ?? item.qty_needed ?? item.qty);
  const wasteFactor = toNumber(item.waste_factor ?? ((item.waste_persen ?? 0) / 100));
  const costPerUnit = toNumber(item.cost_per_unit ?? item.cost);
  const totalCost = toNumber(item.total_cost ?? item.subtotal ?? costPerUnit * qtyRequired * (1 + wasteFactor));

  return {
    id: item.id,
    raw_material_id: item.raw_material_id,
    qty_required: qtyRequired,
    waste_factor: wasteFactor,
    cost_per_unit: costPerUnit,
    total_cost: totalCost,
    persisted: true,
  };
}

function recalculateDraft(
  item: BomDraft,
  material: RawMaterialWithStock | undefined,
  materialId = item.raw_material_id
): BomDraft {
  const costPerUnit = materialUnitCost(material);
  return {
    ...item,
    raw_material_id: materialId,
    cost_per_unit: costPerUnit,
    total_cost: costPerUnit * item.qty_required * (1 + item.waste_factor),
  };
}

export function BOMEditorPage() {
  const { id } = useParams();
  const productId = id as string;
  const editorQuery = useProductBomEditorData(productId);

  useEffect(() => {
    if (editorQuery.isError) {
      toast.error(getErrorMessage(editorQuery.error, "Gagal memuat resep (BOM)"));
    }
  }, [editorQuery.isError, editorQuery.error]);

  if (editorQuery.isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center text-sm text-gray-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Memuat resep (BOM)...
      </div>
    );
  }

  // key: draf dibangun ulang dari server setiap kali data dimuat ulang.
  return (
    <BomEditor
      key={editorQuery.dataUpdatedAt}
      productId={productId}
      data={editorQuery.data}
      reloading={editorQuery.isFetching}
      onReload={() => editorQuery.refetch()}
    />
  );
}

interface BomEditorProps {
  productId: string;
  data: ReturnType<typeof useProductBomEditorData>["data"];
  reloading: boolean;
  onReload: () => Promise<unknown>;
}

function BomEditor({ productId, data, reloading, onReload }: BomEditorProps) {
  const searchParams = useSearchParams();
  const fromProduction = searchParams.get("from") === "production";
  const product = data?.product ?? null;
  const materials = (data?.materials ?? []).filter((material) => material.source_product_id !== productId);
  const materialMap = new Map(materials.map((material) => [material.id, material]));
  const recalculate = (item: BomDraft, materialId = item.raw_material_id) =>
    recalculateDraft(item, materialMap.get(materialId), materialId);

  const [bomItems, setBomItems] = useState<BomDraft[]>(() =>
    (data?.bom ?? []).map((bomItem) => recalculate(mapBomItem(bomItem)))
  );
  const [savingAll, setSavingAll] = useState(false);

  const createBomMutation = useCreateBOMItem();
  const updateBomMutation = useUpdateBOMItem();
  const deleteBomMutation = useDeleteBOMItem();

  const totalHpp = bomItems.reduce((sum, item) => sum + item.total_cost, 0);
  const wipCount = bomItems.filter((item) => materialMap.get(item.raw_material_id)?.material_type === "WIP").length;
  const rawCount = bomItems.length - wipCount;

  function addItem() {
    setBomItems((items) => [
      ...items,
      recalculate({
        id: crypto.randomUUID(),
        raw_material_id: "",
        qty_required: 1,
        waste_factor: 0,
        cost_per_unit: 0,
        total_cost: 0,
        persisted: false,
      }),
    ]);
  }

  function updateItem(id: string, changes: Partial<BomDraft>) {
    setBomItems((items) =>
      items.map((item) =>
        item.id === id ? recalculate({ ...item, ...changes }, changes.raw_material_id) : item
      )
    );
  }

  async function saveItem(item: BomDraft, options?: { silent?: boolean }) {
    if (!item.raw_material_id) {
      throw new Error("Bahan baku wajib diisi");
    }
    if (item.qty_required <= 0) {
      throw new Error("Qty harus lebih dari 0");
    }

    const payload = {
      raw_material_id: item.raw_material_id,
      qty_required: item.qty_required,
      waste_factor: item.waste_factor,
    };

    if (item.persisted) {
      await updateBomMutation.mutateAsync({ id: item.id, payload });
    } else {
      const created = await createBomMutation.mutateAsync({ productId, payload });
      setBomItems((items) =>
        items.map((current) => current.id === item.id ? mapBomItem(created) : current)
      );
    }

    if (!options?.silent) {
      toast.success("Resep (BOM) berhasil disimpan");
      await onReload();
    }
  }

  async function removeItem(item: BomDraft) {
    if (!item.persisted) {
      setBomItems((items) => items.filter((current) => current.id !== item.id));
      return;
    }

    try {
      await deleteBomMutation.mutateAsync(item.id);
      setBomItems((items) => items.filter((current) => current.id !== item.id));
      toast.success("Bahan dihapus dari resep (BOM)");
    } catch (error: unknown) {
      console.error("Error deleting BOM item:", error);
      toast.error(getErrorMessage(error, "Gagal menghapus bahan dari resep (BOM)"));
    }
  }

  async function saveAll() {
    if (bomItems.length === 0) return;

    if (bomItems.some((item) => !item.raw_material_id)) {
      toast.error("Lengkapi bahan baku di setiap baris");
      return;
    }
    if (bomItems.some((item) => item.qty_required <= 0)) {
      toast.error("Qty setiap bahan harus lebih dari 0");
      return;
    }

    setSavingAll(true);
    try {
      for (const item of bomItems) {
        await saveItem(item, { silent: true });
      }
      toast.success("Resep (BOM) berhasil disimpan");
      await onReload();
    } catch (error: unknown) {
      console.error("Error saving BOM:", error);
      toast.error(getErrorMessage(error, "Gagal menyimpan resep (BOM)"));
    } finally {
      setSavingAll(false);
    }
  }

  const backHref = fromProduction
    ? PRODUCT_ROUTES.productionHub
    : PRODUCT_ROUTES.productsDetail(productId);

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={backHref}
        title="Editor Resep (BOM)"
        description={
          <>
            {displayName(product?.nama)} · Total estimasi HPP {formatNumber(totalHpp)}
          </>
        }
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={onReload}
            disabled={reloading}
            className="purchasing-secondary-button w-full sm:w-auto"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${reloading ? "animate-spin" : ""}`} />
            Muat Ulang
          </Button>
        }
      />

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="flex flex-row items-start justify-between border-b border-gray-200/70 pb-3">
          <div>
            <CardTitle className="text-base">Komponen Resep</CardTitle>
            <p className="mt-1 text-xs text-gray-500">
              Bahan baku dan item WIP dapat dipakai sebagai komponen. WIP dari produk yang sama
              disembunyikan otomatis.
            </p>
          </div>
          <CardAction>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addItem}
              className="border-pink-200 text-pink-700 hover:bg-pink-50"
            >
              <Plus className="mr-1 h-4 w-4" />
              Tambah Bahan
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200/70 bg-gray-50 px-4 py-3">
              <p className="text-xs font-medium text-gray-500">Total Komponen</p>
              <p className="mt-1 text-lg font-semibold text-gray-950">{bomItems.length}</p>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3">
              <p className="text-xs font-medium text-emerald-700">Bahan Baku</p>
              <p className="mt-1 text-lg font-semibold text-emerald-800">{rawCount}</p>
            </div>
            <div className="rounded-lg border border-sky-100 bg-sky-50 px-4 py-3">
              <p className="text-xs font-medium text-sky-700">WIP</p>
              <p className="mt-1 text-lg font-semibold text-sky-800">{wipCount}</p>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-200/70">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Bahan Baku</th>
                  <th className="w-[170px] px-4 py-3 text-left font-semibold">Qty</th>
                  <th className="w-[140px] px-4 py-3 text-left font-semibold">Waste (%)</th>
                  <th className="w-[140px] px-4 py-3 text-right font-semibold">Biaya Satuan</th>
                  <th className="w-[140px] px-4 py-3 text-right font-semibold">Subtotal</th>
                  <th className="w-[56px] px-4 py-3" aria-label="Hapus" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bomItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-gray-400">
                      Belum ada komponen resep. Klik &quot;Tambah Bahan&quot; untuk mulai.
                    </td>
                  </tr>
                ) : (
                  bomItems.map((item) => {
                    const material = materialMap.get(item.raw_material_id);
                    return (
                      <tr key={item.id} className="align-top hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <Combobox
                            options={materials.map((materialOption) => ({
                              value: materialOption.id,
                              label: displayName(materialOption.nama),
                              description: `${materialOption.material_type === "WIP" ? "WIP" : "Bahan"} · ${materialOption.kode}`,
                            }))}
                            value={item.raw_material_id}
                            onChange={(value) => updateItem(item.id, { raw_material_id: value })}
                            placeholder="Pilih bahan..."
                            searchPlaceholder="Cari bahan..."
                            emptyMessage="Bahan tidak ditemukan"
                            allowClear
                            className="w-full"
                          />
                          {material && (
                            <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                              <span>{material.kode}</span>
                              {material.material_type === "WIP" && (
                                <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-semibold text-sky-700">
                                  WIP
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Label className="sr-only">Qty</Label>
                          <div className="flex w-full rounded-lg border border-gray-200/70 bg-white focus-within:border-pink-300 focus-within:ring-2 focus-within:ring-pink-100">
                            <NumericInput
                              min="0"
                              step="0.0001"
                              value={item.qty_required}
                              onValueChange={(value) => updateItem(item.id, { qty_required: value })}
                              decimalScale={4}
                              className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                            />
                            <div className="flex min-w-14 items-center justify-center rounded-r-lg border-l border-gray-200/70 bg-gray-50 px-3 text-xs font-semibold uppercase text-gray-500">
                              {materialSmallUnitLabel(material, "Unit")}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Label className="sr-only">Waste</Label>
                          <div className="flex w-full rounded-lg border border-gray-200/70 bg-white focus-within:border-pink-300 focus-within:ring-2 focus-within:ring-pink-100">
                            <NumericInput
                              min="0"
                              max="100"
                              step="0.1"
                              value={Math.round(item.waste_factor * 10000) / 100}
                              onValueChange={(value) => updateItem(item.id, { waste_factor: value / 100 })}
                              decimalScale={2}
                              className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                            />
                            <div className="flex min-w-10 items-center justify-center rounded-r-lg border-l border-gray-200/70 bg-gray-50 px-3 text-xs font-semibold text-gray-500">
                              %
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right align-middle">
                          <div className="font-mono text-sm text-gray-700">{formatNumber(item.cost_per_unit)}</div>
                          {material && (
                            <div className="text-[11px] text-gray-400">/ {materialSmallUnitLabel(material, "Unit")}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right align-middle">
                          <span className="font-mono text-sm font-semibold text-gray-900">
                            {formatNumber(item.total_cost)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right align-middle">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeItem(item)}
                            title="Hapus bahan"
                            className="text-gray-400 hover:bg-red-50 hover:text-red-600"
                            aria-label="Hapus bahan"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot className="border-t border-gray-200/70 bg-gray-50/80">
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-right text-sm font-semibold text-gray-600">
                    Total Estimasi HPP
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm font-bold text-gray-900">
                    {formatNumber(totalHpp)}
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-3 border-t border-gray-200/70 pt-4 sm:flex-row sm:justify-end">
        <Link href={backHref}>
          <Button variant="outline" type="button" className="purchasing-secondary-button w-full sm:w-auto">
            Batal
          </Button>
        </Link>
        <Button
          onClick={saveAll}
          disabled={savingAll || bomItems.length === 0}
          className="purchasing-main-button w-full sm:w-auto"
        >
          {savingAll ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Menyimpan...
            </>
          ) : (
            "Simpan Resep (BOM)"
          )}
        </Button>
      </div>
    </div>
  );
}
