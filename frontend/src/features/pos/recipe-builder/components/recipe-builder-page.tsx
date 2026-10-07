'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, Beaker, Loader2, Plus, Save, Search, Trash2 } from 'lucide-react';
import { formatNumber, formatRupiah as formatCurrency } from '@/lib/format';
import type { BomRow, RecipeProduct, RecipeRawMaterial } from '../types';
import { useProductBom, useRecipeCatalog } from '../queries';
import { useDeleteBomItem, useSaveRecipe } from '../mutations';

const NO_PRODUCTS: RecipeProduct[] = [];
const NO_MATERIALS: RecipeRawMaterial[] = [];

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function RecipeBuilderPage() {
  const { data: catalog, isLoading: loading, error: catalogError } = useRecipeCatalog();
  const products = catalog?.products ?? NO_PRODUCTS;
  const materials = catalog?.materials ?? NO_MATERIALS;

  const [pickedProductId, setSelectedProductId] = useState('');
  // Belum memilih → produk pertama di katalog.
  const selectedProductId = pickedProductId || products[0]?.id || '';
  const [ingredients, setIngredients] = useState<BomRow[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showMaterialPicker, setShowMaterialPicker] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const saveRecipeMutation = useSaveRecipe();
  const deleteBomMutation = useDeleteBomItem();
  const saving = saveRecipeMutation.isPending || deleteBomMutation.isPending;

  const queryError = catalogError instanceof Error ? catalogError.message : '';

  const { data: bomRows, error: bomError } = useProductBom(selectedProductId);
  // BOM server baru (ganti produk / setelah simpan) → draf bahan direset saat render.
  const [syncedBom, setSyncedBom] = useState<BomRow[] | undefined>(undefined);
  if (bomRows && bomRows !== syncedBom) {
    setSyncedBom(bomRows);
    setIngredients(bomRows);
  }

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) || null,
    [products, selectedProductId]
  );

  const filteredMaterials = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const existingIds = new Set(ingredients.map((item) => item.raw_material_id));
    return materials
      .filter((material) => !existingIds.has(material.id))
      .filter((material) => !query || `${material.nama || material.name || ''} ${material.kode || ''}`.toLowerCase().includes(query))
      .slice(0, 50);
  }, [ingredients, materials, searchTerm]);

  function addIngredient(material: RecipeRawMaterial) {
    setIngredients((current) => [
      ...current,
      {
        raw_material_id: material.id,
        name: material.nama || material.name || 'Bahan',
        unit: material.satuan_besar_nama || material.satuan || '-',
        quantity: 1,
        wasteFactor: 0,
        costPerUnit: toNumber(material.avg_cost),
      },
    ]);
    setShowMaterialPicker(false);
    setSearchTerm('');
    setSuccess('');
  }

  function updateIngredient(index: number, changes: Partial<BomRow>) {
    setIngredients((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item));
    setSuccess('');
  }

  async function removeIngredient(index: number) {
    const item = ingredients[index];
    if (!item) return;
    setError('');
    setSuccess('');

    if (!item.id) {
      setIngredients((current) => current.filter((_, itemIndex) => itemIndex !== index));
      return;
    }

    try {
      await deleteBomMutation.mutateAsync({ id: item.id, productId: selectedProductId });
      setIngredients((current) => current.filter((_, itemIndex) => itemIndex !== index));
      setSuccess('Bahan berhasil dihapus dari resep');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus bahan');
    }
  }

  async function saveRecipe() {
    if (!selectedProductId) return;
    setError('');
    setSuccess('');
    try {
      await saveRecipeMutation.mutateAsync({ productId: selectedProductId, items: ingredients });
      setSuccess('Resep berhasil disimpan');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan resep');
    }
  }

  const totalIngredientCost = ingredients.reduce((sum, item) => {
    const qtyWithWaste = item.quantity * (1 + item.wasteFactor);
    return sum + qtyWithWaste * item.costPerUnit;
  }, 0);
  const sellingPrice = toNumber(selectedProduct?.harga_jual);
  const margin = sellingPrice - totalIngredientCost;
  const marginPct = sellingPrice > 0 ? (margin / sellingPrice) * 100 : 0;

  const displayError = error || queryError || (bomError instanceof Error ? bomError.message : '');

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Recipe Builder</h1>
          <p className="text-sm text-gray-500">Kelola Bill of Materials produk dari data purchasing real.</p>
        </div>
        <button
          onClick={saveRecipe}
          disabled={saving || !selectedProductId}
          className="flex items-center justify-center gap-2 rounded-lg bg-pink-600 px-4 py-2 font-medium text-white transition-colors hover:bg-pink-700 disabled:bg-gray-300"
        >
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
          Simpan Resep
        </button>
      </div>

      {displayError && <Notice tone="red" icon={AlertCircle} text={displayError} />}
      {success && <Notice tone="green" icon={Beaker} text={success} />}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-20 text-sm text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Memuat data recipe...
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white py-20 text-center text-sm text-gray-500">
          Belum ada produk purchasing untuk dibuatkan resep.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <section className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">Informasi Produk</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Produk</label>
                  <select
                    value={selectedProductId}
                    onChange={(event) => setSelectedProductId(event.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                  >
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>{product.nama || product.name || product.kode || product.id}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Harga Jual</label>
                  <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900">{formatCurrency(sellingPrice)}</div>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-base font-semibold text-gray-900 sm:text-lg">Bahan-bahan</h2>
                <button onClick={() => setShowMaterialPicker(true)} className="flex items-center justify-center gap-2 rounded-lg bg-pink-50 px-3 py-2 text-sm font-semibold text-pink-700 hover:bg-pink-100">
                  <Plus className="h-4 w-4" />
                  Tambah Bahan
                </button>
              </div>

              {ingredients.length === 0 ? (
                <div className="py-10 text-center text-gray-400">
                  <Beaker className="mx-auto mb-3 h-12 w-12 opacity-50" />
                  <p>Belum ada bahan</p>
                </div>
              ) : (
                <div className="space-y-3 overflow-x-auto">
                  <div className="grid min-w-[720px] grid-cols-12 gap-2 border-b pb-2 text-sm font-medium text-gray-500">
                    <div className="col-span-4">Bahan</div>
                    <div className="col-span-2">Jumlah</div>
                    <div className="col-span-2">Waste</div>
                    <div className="col-span-3">Subtotal</div>
                    <div className="col-span-1"></div>
                  </div>
                  {ingredients.map((ingredient, index) => {
                    const lineCost = ingredient.quantity * (1 + ingredient.wasteFactor) * ingredient.costPerUnit;
                    return (
                      <div key={`${ingredient.raw_material_id}-${ingredient.id || index}`} className="grid min-w-[720px] grid-cols-12 items-center gap-2">
                        <div className="col-span-4">
                          <div className="font-medium text-gray-900">{ingredient.name}</div>
                          <div className="text-xs text-gray-500">{ingredient.unit} · {formatCurrency(ingredient.costPerUnit)}</div>
                        </div>
                        <div className="col-span-2">
                          <input type="number" step="0.01" value={ingredient.quantity} onChange={(event) => updateIngredient(index, { quantity: Number.parseFloat(event.target.value) || 0 })} className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" />
                        </div>
                        <div className="col-span-2">
                          <input type="number" step="0.01" value={Math.round(ingredient.wasteFactor * 100)} onChange={(event) => updateIngredient(index, { wasteFactor: (Number.parseFloat(event.target.value) || 0) / 100 })} className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" />
                        </div>
                        <div className="col-span-3 font-medium text-gray-900">{formatCurrency(lineCost)}</div>
                        <div className="col-span-1">
                          <button onClick={() => removeIngredient(index)} disabled={saving} className="text-red-500 hover:text-red-700 disabled:opacity-50">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-6">
            <section className="sticky top-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">Ringkasan HPP</h2>
              <CostLine label="Total Bahan" value={formatCurrency(totalIngredientCost)} />
              <CostLine label="Harga Jual" value={formatCurrency(sellingPrice)} />
              <CostLine label="Margin" value={formatCurrency(margin)} strong />
              <div className="mt-4 rounded-lg bg-pink-50 px-4 py-3">
                <div className="text-xs text-pink-700">Margin %</div>
                <div className="text-2xl font-bold text-pink-700">{Math.round(marginPct * 10) / 10}%</div>
              </div>
            </section>
          </aside>
        </div>
      )}

      {showMaterialPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="border-b p-4">
              <h3 className="font-semibold text-gray-900">Pilih Bahan Baku</h3>
              <div className="relative mt-3">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Cari bahan baku..." className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" autoFocus />
              </div>
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-2">
              {filteredMaterials.length === 0 ? (
                <div className="py-10 text-center text-sm text-gray-400">Bahan tidak ditemukan</div>
              ) : (
                filteredMaterials.map((material) => (
                  <button key={material.id} onClick={() => addIngredient(material)} className="flex w-full items-center justify-between rounded-lg p-3 text-left hover:bg-pink-50">
                    <div>
                      <div className="font-medium text-gray-900">{material.nama || material.name || 'Bahan'}</div>
                      <div className="text-xs text-gray-500">{material.kode || '-'} · Stock {formatNumber(toNumber(material.qty_onhand), 3)}</div>
                    </div>
                    <div className="text-right text-xs font-semibold text-gray-700">{formatCurrency(toNumber(material.avg_cost))}</div>
                  </button>
                ))
              )}
            </div>
            <div className="border-t p-3">
              <button onClick={() => setShowMaterialPicker(false)} className="w-full rounded-lg bg-gray-100 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CostLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="mb-3 flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={strong ? 'font-bold text-pink-600' : 'font-medium text-gray-900'}>{value}</span>
    </div>
  );
}

function Notice({ tone, icon: Icon, text }: { tone: 'red' | 'green'; icon: typeof AlertCircle; text: string }) {
  const className = tone === 'red'
    ? 'border-red-200 bg-red-50 text-red-700'
    : 'border-green-200 bg-green-50 text-green-700';
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold ${className}`}>
      <Icon className="h-4 w-4" />
      {text}
    </div>
  );
}
