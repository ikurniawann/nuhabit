"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { PurchasingFormHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { useErrorToast } from "@/features/purchasing/reports/use-error-toast";
import { formatNumber } from "@/lib/format";
import { RM_ROUTES } from "@/lib/purchasing/item-routes";
import {
  bomDraftError,
  bomDraftFromRow,
  newBomDraft,
  recalculateBomDraft,
  type BomDraft,
} from "@/lib/purchasing/production-ui-bom";
import { displayName, toNumber } from "@/lib/purchasing/production-ui-display";
import type { RawMaterialWithStock } from "@/types/purchasing";
import { createRawMaterialBomItem, deleteRawMaterialBomItem, updateRawMaterialBomItem } from "../api";
import { useRawMaterialBomEditorData } from "../queries";
import type { RawMaterialBomRow } from "../types";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function RawMaterialBomEditorPage() {
  const materialId = useParams<{ id: string }>().id;
  const fromProduction = useSearchParams().get("from") === "production";
  const editorQuery = useRawMaterialBomEditorData(materialId);
  useErrorToast(editorQuery.error, "Gagal memuat resep (BOM)");

  if (editorQuery.isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center text-sm text-gray-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Memuat resep (BOM)...
      </div>
    );
  }

  return (
    // Setiap data baru dari server (muat ulang / setelah simpan) me-reset draf lokal.
    <BomEditor
      key={editorQuery.dataUpdatedAt}
      materialId={materialId}
      materialName={editorQuery.data?.material?.nama}
      bom={editorQuery.data?.bom ?? []}
      components={editorQuery.data?.materials ?? []}
      backHref={fromProduction ? RM_ROUTES.productionRecipes : RM_ROUTES.materialsDetail(materialId)}
      refreshing={editorQuery.isFetching}
      onRefresh={() => void editorQuery.refetch()}
    />
  );
}

type BomEditorProps = {
  materialId: string;
  materialName?: string;
  bom: RawMaterialBomRow[];
  components: RawMaterialWithStock[];
  backHref: string;
  refreshing: boolean;
  onRefresh: () => void;
};

function BomEditor({ materialId, materialName, bom, components, backHref, refreshing, onRefresh }: BomEditorProps) {
  const componentById = new Map(components.map((item) => [item.id, item]));
  const recalc = (item: BomDraft) => recalculateBomDraft(item, componentById.get(item.raw_material_id));

  const [items, setItems] = useState<BomDraft[]>(() => bom.map((row) => recalc(bomDraftFromRow(row))));
  const [savingAll, setSavingAll] = useState(false);
  const totalHpp = items.reduce((sum, item) => sum + item.total_cost, 0);
  const options = components.map((component) => ({
    value: component.id,
    label: `${displayName(component.nama)} (${component.kode || "-"})`,
  }));

  const updateItem = (id: string, changes: Partial<BomDraft>) =>
    setItems((current) => current.map((item) => (item.id === id ? recalc({ ...item, ...changes }) : item)));

  async function saveItem(item: BomDraft) {
    const invalid = bomDraftError(item);
    if (invalid) throw new Error(invalid);
    const payload = { qty_required: item.qty_required, waste_factor: item.waste_factor };
    if (item.persisted) {
      await updateRawMaterialBomItem(item.id, payload);
      return;
    }
    const created = await createRawMaterialBomItem(materialId, {
      component_raw_material_id: item.raw_material_id,
      ...payload,
    });
    // Tandai tersimpan supaya percobaan ulang setelah gagal tidak membuat duplikat.
    setItems((current) => current.map((row) => (row.id === item.id ? bomDraftFromRow(created) : row)));
  }

  async function removeItem(item: BomDraft) {
    try {
      if (item.persisted) await deleteRawMaterialBomItem(item.id);
      setItems((current) => current.filter((row) => row.id !== item.id));
      if (item.persisted) toast.success("Komponen dihapus");
    } catch (error) {
      toast.error(errorMessage(error, "Gagal menghapus komponen"));
    }
  }

  async function saveAll() {
    setSavingAll(true);
    try {
      for (const item of items) await saveItem(item);
      toast.success("Resep (BOM) disimpan");
      onRefresh();
    } catch (error) {
      toast.error(errorMessage(error, "Gagal menyimpan resep (BOM)"));
    } finally {
      setSavingAll(false);
    }
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={backHref}
        title="Resep (BOM) Bahan Baku"
        description={
          <>
            {displayName(materialName)} · Total estimasi HPP {formatNumber(totalHpp)}
          </>
        }
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={onRefresh}
            disabled={refreshing}
            className="purchasing-secondary-button w-full sm:w-auto"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Muat Ulang
          </Button>
        }
      />

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="flex flex-row items-start justify-between border-b border-gray-200/70 pb-3">
          <div>
            <CardTitle className="text-base">Komponen Bahan</CardTitle>
            <p className="mt-1 text-xs text-gray-500">
              Tentukan bahan baku yang dikonsumsi untuk memproduksi bahan output ini.
            </p>
          </div>
          <CardAction>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setItems((current) => [...current, recalc(newBomDraft(crypto.randomUUID()))])}
              className="border-pink-200 text-pink-700 hover:bg-pink-50"
            >
              <Plus className="mr-1 h-4 w-4" />
              Tambah Komponen
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="overflow-x-auto rounded-lg border border-gray-200/70">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Komponen</th>
                  <th className="w-[170px] px-4 py-3 text-left font-semibold">Qty</th>
                  <th className="w-[140px] px-4 py-3 text-left font-semibold">Susut (%)</th>
                  <th className="w-[140px] px-4 py-3 text-right font-semibold">Harga Satuan</th>
                  <th className="w-[140px] px-4 py-3 text-right font-semibold">Subtotal</th>
                  <th className="w-[56px] px-4 py-3" aria-label="Hapus" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-gray-400">
                      Belum ada komponen. Klik &quot;Tambah Komponen&quot; untuk memulai.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-gray-500">Komponen</Label>
                          <Combobox
                            options={options}
                            value={item.raw_material_id}
                            onChange={(value) => updateItem(item.id, { raw_material_id: value })}
                            placeholder="Pilih komponen..."
                            searchPlaceholder="Cari bahan baku..."
                            emptyMessage="Bahan baku tidak ditemukan"
                            className="w-full! h-9 text-sm"
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 align-bottom">
                        <NumericInput
                          value={item.qty_required}
                          onValueChange={(value) => updateItem(item.id, { qty_required: toNumber(value) })}
                          className="h-9 text-sm"
                        />
                      </td>
                      <td className="px-4 py-3 align-bottom">
                        <NumericInput
                          value={item.waste_factor * 100}
                          onValueChange={(value) => updateItem(item.id, { waste_factor: toNumber(value) / 100 })}
                          className="h-9 text-sm"
                        />
                      </td>
                      <td className="px-4 py-3 text-right align-bottom font-medium">
                        {formatNumber(item.cost_per_unit)}
                      </td>
                      <td className="px-4 py-3 text-right align-bottom font-semibold text-pink-700">
                        {formatNumber(item.total_cost)}
                      </td>
                      <td className="px-4 py-3 text-right align-bottom">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void removeItem(item)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => void saveAll()}
              disabled={savingAll || items.length === 0}
              className="purchasing-main-button"
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
        </CardContent>
      </Card>
    </div>
  );
}
