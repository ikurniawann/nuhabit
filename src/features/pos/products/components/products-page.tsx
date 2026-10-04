'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Package, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PurchasingPageHeader } from '@/features/purchasing/components/shared/purchasing-page-header';
import { PurchasingListSection } from '@/features/purchasing/components/shared/purchasing-list-section';
import { SALES_CHANNEL_PRESETS } from '@/lib/pos/sales-channels';
import { usePatchPosProduct } from '../mutations';
import { ALL_CATEGORIES, filterProducts, parseBonusXp, parseMinXp, productCategories } from '../product-rules';
import { usePosCatalogProducts } from '../queries';
import type { PatchPosProductPayload, PosCatalogProduct } from '../types';
import { MerchSettingsDialog } from './merch-settings-dialog';
import { ModifiersDialog } from './modifiers-dialog';
import { PRODUCT_TABLE_HEADERS, ProductTableRow, type ProductRowActions } from './product-table-row';
import { VariantsDialog } from './variants-dialog';

type LocalEdit = Partial<Pick<PosCatalogProduct, 'variants' | 'modifierGroups' | 'hasVariants' | 'hasModifiers'>>;
type OpenDialog = { kind: 'variants' | 'modifiers' | 'merch'; product: PosCatalogProduct } | null;

const SEARCH_DEBOUNCE_MS = 300;
const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export function ProductsPage() {
  const { data: products = [], isLoading: loading, error: queryError } = usePosCatalogProducts();
  const patchProductMutation = usePatchPosProduct();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORIES);
  const [savingProductId, setSavingProductId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  // Varian & modifier hanya disimpan lokal (belum ada endpoint penyimpanannya).
  const [localEdits, setLocalEdits] = useState<Record<string, LocalEdit>>({});

  useEffect(() => {
    if (queryError instanceof Error) toast.error(queryError.message);
  }, [queryError]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearchTerm(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const displayProducts = useMemo(
    () => products.map((product) => (localEdits[product.id] ? { ...product, ...localEdits[product.id] } : product)),
    [products, localEdits]
  );
  const categories = useMemo(() => productCategories(displayProducts), [displayProducts]);
  const filteredProducts = filterProducts(displayProducts, searchTerm, selectedCategory);
  const hasActiveFilters = searchQuery.trim().length > 0 || selectedCategory !== ALL_CATEGORIES;

  /** Satu patch produk dalam satu waktu; pesan sukses/galat per aksi. */
  async function patchProduct(id: string, payload: PatchPosProductPayload, success: string, failure: string) {
    if (savingProductId) return;
    setSavingProductId(id);
    try {
      await patchProductMutation.mutateAsync({ id, payload });
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : failure);
    } finally {
      setSavingProductId(null);
    }
  }

  function saveLocalEdit(productId: string, edit: LocalEdit, message: string) {
    setLocalEdits((prev) => ({ ...prev, [productId]: edit }));
    toast.success(message);
    setDialog(null);
  }

  const actions: ProductRowActions = {
    onActiveChange: (product, active) =>
      void patchProduct(
        product.id,
        { is_active: active },
        `Product ${active ? 'activated' : 'deactivated'} successfully`,
        'Failed to update product status'
      ),
    onStationChange: (product, station) =>
      void patchProduct(product.id, { station }, 'Station updated successfully', 'Failed to update station'),
    // EPIC-039 Fase A — ganti jenis produk (regular ↔ merchandise)
    onKindChange: (product, kind) =>
      void patchProduct(
        product.id,
        { product_kind: kind },
        kind === 'merchandise'
          ? 'Produk jadi merchandise — atur tautan purchasing & stok lewat tombol stok'
          : 'Produk jadi regular',
        'Gagal mengganti jenis produk'
      ),
    // Produk privilege member (EPIC-011 Fase C): syarat min XP; kosong = umum
    onMinXpChange: (product, raw) => {
      const minXp = parseMinXp(raw);
      void patchProduct(
        product.id,
        { min_xp: minXp },
        minXp ? `Syarat member ≥ ${minXp} XP tersimpan` : 'Produk jadi umum (tanpa syarat XP)',
        'Gagal menyimpan syarat XP'
      );
    },
    // Bonus XP per unit saat order member lunas; 0 = tanpa bonus
    onBonusXpChange: (product, raw) => {
      const bonusXp = parseBonusXp(raw);
      void patchProduct(
        product.id,
        { bonus_xp: bonusXp },
        bonusXp ? `Bonus ${bonusXp} XP per unit tersimpan` : 'Bonus XP dimatikan',
        'Gagal menyimpan bonus XP'
      );
    },
    onSalesChannelsChange: (product, presetKey) => {
      const preset = SALES_CHANNEL_PRESETS.find((item) => item.key === presetKey);
      if (!preset) return;
      void patchProduct(
        product.id,
        { sales_channels: preset.channels },
        `${product.name}: dijual di ${preset.label.toLowerCase()}`,
        'Gagal menyimpan channel penjualan'
      );
    },
    onOpenMerch: (product) => setDialog({ kind: 'merch', product }),
    onOpenVariants: (product) => setDialog({ kind: 'variants', product }),
    onOpenModifiers: (product) => setDialog({ kind: 'modifiers', product }),
  };

  function resetFilters() {
    setSearchQuery('');
    setSearchTerm('');
    setSelectedCategory(ALL_CATEGORIES);
  }

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Products & Menu"
        description="Manage POS products, variants, modifiers, and kitchen stations."
      />

      <PurchasingListSection
        icon={Package}
        title="Product Catalog"
        description={`${filteredProducts.length} product${filteredProducts.length === 1 ? '' : 's'} shown`}
        toolbar={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="relative min-w-[220px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                aria-label="Search products"
                placeholder="Search products..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="h-9 pl-9"
              />
            </div>
            {hasActiveFilters ? (
              <Button type="button" variant="outline" size="sm" onClick={resetFilters} className="h-9 gap-1.5">
                <X className="h-3.5 w-3.5" />
                Reset
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="border-b border-gray-100 px-5 py-3">
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <Button
                key={category}
                type="button"
                variant={selectedCategory === category ? 'default' : 'outline'}
                size="sm"
                className="h-8"
                onClick={() => setSelectedCategory(category)}
              >
                {category}
              </Button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-gray-400">
            <Loader2 className="h-8 w-8 animate-spin text-pink-500" />
            <p className="text-sm">Loading products...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-gray-400">
            <Package className="h-12 w-12 opacity-40" />
            <p className="text-sm">No products found</p>
          </div>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  {PRODUCT_TABLE_HEADERS.map((header) => (
                    <th key={header.label} className={`px-4 py-3 font-semibold ${ALIGN[header.align]}`}>
                      {header.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredProducts.map((product) => (
                  <ProductTableRow
                    key={product.id}
                    product={product}
                    saving={savingProductId === product.id}
                    actions={actions}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
          Est. COGS for synced products (SKU PUR-*) is calculated from the latest BOM.
        </div>
      </PurchasingListSection>

      {dialog?.kind === 'merch' ? (
        <MerchSettingsDialog
          key={dialog.product.id}
          product={dialog.product}
          saving={savingProductId !== null}
          onClose={() => setDialog(null)}
          onSaveProduct={(payload) => patchProductMutation.mutateAsync({ id: dialog.product.id, payload }).then(() => {})}
        />
      ) : null}
      {dialog?.kind === 'variants' ? (
        <VariantsDialog
          key={dialog.product.id}
          product={dialog.product}
          onClose={() => setDialog(null)}
          onSave={(variants) =>
            saveLocalEdit(
              dialog.product.id,
              { variants, hasVariants: variants.some((variant) => variant.active) },
              'Variants saved locally'
            )
          }
        />
      ) : null}
      {dialog?.kind === 'modifiers' ? (
        <ModifiersDialog
          key={dialog.product.id}
          product={dialog.product}
          onClose={() => setDialog(null)}
          onSave={(modifierGroups) =>
            saveLocalEdit(
              dialog.product.id,
              { modifierGroups, hasModifiers: modifierGroups.some((group) => group.active) },
              'Modifiers saved locally'
            )
          }
        />
      ) : null}
    </div>
  );
}
