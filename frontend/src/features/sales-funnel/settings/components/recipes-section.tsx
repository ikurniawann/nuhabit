"use client";

import { useEffect, useState } from "react";
import { BeakerIcon } from "@heroicons/react/24/outline";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useCatalogProducts } from "../../quotations/queries";
import type { RawMaterialOption, RecipeRowResponse } from "../api";
import { useRawMaterialSearch, useRecipe, useSaveRecipe } from "../queries";

interface RecipeRow {
  raw_material_id: string;
  material_label: string;
  quantity_per_unit: string;
  unit_of_measure: string;
  waste_percentage: string;
}

const materialLabel = (nama: string, satuan: string | null) => `${nama}${satuan ? ` (${satuan})` : ""}`;

function toRow(row: RecipeRowResponse): RecipeRow {
  return {
    raw_material_id: row.raw_material_id,
    material_label: materialLabel(row.material_nama, row.satuan_kecil),
    quantity_per_unit: String(Number(row.quantity_per_unit)),
    unit_of_measure: row.unit_of_measure ?? row.satuan_kecil ?? "",
    waste_percentage: String(Number(row.waste_percentage)),
  };
}

/**
 * Editor resep produk (Fase F3) — bahan baku per 1 pax/unit. Prasyarat
 * realisasi BOM: tanpa resep, tombol Realisasi tidak punya apa pun untuk
 * dipotong.
 */
export function RecipesSection() {
  const [productId, setProductId] = useState("");
  const productsQuery = useCatalogProducts();
  const products = productsQuery.data ?? [];
  const recipeQuery = useRecipe(productId);

  return (
    <PurchasingListSection
      icon={BeakerIcon}
      title="Resep Produk (BOM)"
      description="Bahan baku per 1 pax/unit produk — dasar tombol Realisasi memotong stok gudang venue."
    >
      <div className="space-y-4 px-4 pb-4">
        <div className="max-w-sm">
          <Select value={productId || undefined} onValueChange={setProductId}>
            <SelectTrigger className="h-10 bg-white">
              <SelectValue placeholder="Pilih produk katalog..." />
            </SelectTrigger>
            <SelectContent>
              {products.map((product) => (
                <SelectItem key={product.id} value={product.id}>
                  {product.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {productId === "" ? (
          <p className="py-4 text-sm text-gray-400">
            Pilih produk untuk melihat / menyusun resepnya.
          </p>
        ) : recipeQuery.isLoading ? (
          <div className="py-6 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-pink-600" />
          </div>
        ) : (
          <RecipeEditor key={productId} productId={productId} initialRows={(recipeQuery.data ?? []).map(toRow)} />
        )}
      </div>
    </PurchasingListSection>
  );
}

/** Baris resep satu produk; di-mount ulang per produk (key) dari data server. */
function RecipeEditor({ productId, initialRows }: { productId: string; initialRows: RecipeRow[] }) {
  const [rows, setRows] = useState<RecipeRow[]>(initialRows);
  const [materialSearch, setMaterialSearch] = useState("");
  const [materialQuery, setMaterialQuery] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => setMaterialQuery(materialSearch.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [materialSearch]);

  const materialsQuery = useRawMaterialSearch(materialQuery);
  const materialOptions = (materialsQuery.data ?? []).filter(
    (option) => !rows.some((row) => row.raw_material_id === option.id)
  );
  const saveMutation = useSaveRecipe(productId);

  const addMaterial = (option: RawMaterialOption) => {
    setRows((prev) => [
      ...prev,
      {
        raw_material_id: option.id,
        material_label: materialLabel(option.nama, option.satuan_kecil),
        quantity_per_unit: "1",
        unit_of_measure: option.satuan_kecil ?? "",
        waste_percentage: "0",
      },
    ]);
    setMaterialSearch("");
  };

  const canSave = rows.every((row) => Number(row.quantity_per_unit) > 0 && row.raw_material_id);

  const handleSave = () =>
    saveMutation.mutate(
      rows.map((row) => ({
        raw_material_id: row.raw_material_id,
        quantity_per_unit: Number(row.quantity_per_unit),
        // satuan ditentukan server dari satuan kecil bahan
        waste_percentage: Number(row.waste_percentage) || 0,
      }))
    );

  return (
    <>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 px-4 py-3 text-sm text-amber-700">
          Produk ini belum punya resep — realisasi quotation berisi
          produk ini tidak akan memotong stok apa pun.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div
              key={row.raw_material_id}
              className="grid grid-cols-1 items-center gap-2 rounded-xl border border-gray-200/80 bg-white p-3 sm:grid-cols-12"
            >
              <p className="text-sm font-medium text-gray-900 sm:col-span-5">
                {row.material_label}
              </p>
              <div className="sm:col-span-2">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={row.quantity_per_unit}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r, i) =>
                        i === index
                          ? { ...r, quantity_per_unit: e.target.value }
                          : r
                      )
                    )
                  }
                  title="Jumlah per 1 pax/unit"
                  className="h-9 text-sm"
                />
              </div>
              <div className="flex items-center text-sm text-gray-500 sm:col-span-2">
                {row.unit_of_measure || "unit"}
                <span className="ml-1 text-xs text-gray-400">/ pax</span>
              </div>
              <div className="sm:col-span-2">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={row.waste_percentage}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r, i) =>
                        i === index
                          ? { ...r, waste_percentage: e.target.value }
                          : r
                      )
                    )
                  }
                  title="Waste %"
                  placeholder="waste %"
                  className="h-9 text-sm"
                />
              </div>
              <div className="flex justify-end sm:col-span-1">
                <button
                  type="button"
                  onClick={() =>
                    setRows((prev) => prev.filter((_, i) => i !== index))
                  }
                  className="text-gray-300 hover:text-red-500"
                  aria-label="Hapus bahan"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="max-w-sm space-y-1.5">
        <Input
          value={materialSearch}
          onChange={(e) => setMaterialSearch(e.target.value)}
          placeholder="Tambah bahan: cari nama / kode (min. 2 huruf)"
          className="h-9 bg-white text-sm"
        />
        {materialQuery.length >= 2 && materialOptions.length > 0 ? (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {materialOptions.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  onClick={() => addMaterial(option)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-pink-50"
                >
                  <span>
                    {option.nama}
                    {option.satuan_kecil ? (
                      <span className="ml-1 text-xs text-gray-400">
                        ({option.satuan_kecil})
                      </span>
                    ) : null}
                  </span>
                  <Plus className="h-4 w-4 text-pink-500" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={handleSave}
          disabled={!canSave || saveMutation.isPending}
          className="h-9 rounded-lg bg-pink-600 px-4 text-sm font-semibold text-white hover:bg-pink-700"
        >
          {saveMutation.isPending ? "Menyimpan…" : "Simpan Resep"}
        </Button>
      </div>
    </>
  );
}
