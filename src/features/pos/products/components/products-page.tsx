'use client';

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import {
  Search,
  Package,
  Boxes,
  Settings2,
  Sparkles,
  Save,
  PlusCircle,
  MinusCircle,
  Trash2,
  Loader2,
  X,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogPanel,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelDescription,
  DialogPanelBody,
  DialogFooter,
} from '@/components/ui/dialog';
import { PurchasingPageHeader } from '@/modules/purchasing/components/page/purchasing-page-header';
import { PurchasingListSection } from '@/modules/purchasing/components/list/PurchasingListSection';
import { formatAmount } from '@/lib/purchasing/utils';
import { PosProductThumbnail } from '@/components/pos/PosProductThumbnail';
import { expandMatrix, validateMatrixSize } from '@/lib/pos/merchandise-variants';
import type { PosCatalogProduct, PosProductModifier, PosProductModifierGroup, PosProductVariant } from '../types';
import { usePosCatalogProducts } from '../queries';
import { usePatchPosProduct } from '../mutations';
import { SALES_CHANNEL_PRESETS, salesChannelPresetKey, salesChannelSummary } from '@/lib/pos/sales-channels';
import {
  createProductSku,
  patchProductSku,
  deleteProductSku,
  createSkuMatrix,
  SkuMatrixConflictError,
  type BlockedSkuMatrixRow,
} from '../api';

const generateId = () => Math.random().toString(36).slice(2, 11);

const stationOptions = [
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'bar', label: 'Bar' },
  { value: 'bakery', label: 'Bakery' },
  { value: 'dessert', label: 'Dessert' },
  { value: 'merchandise', label: 'Merchandise' },
  { value: 'photobooth', label: 'Photobooth' },
];

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// EPIC-039 Fase A — pilihan tautan master purchasing (item.products)
type PurchasingProductOption = {
  id: string;
  kode?: string | null;
  nama?: string | null;
};

type MerchFormState = {
  sourceProductId: string;
  stock: string;
  weightGram: string;
  webDistributed: boolean;
};

// EPIC-039 Fase B — baris editor varian SKU (persisted bila id terisi)
type MerchSkuRow = {
  rowId: string;
  id?: string;
  sku: string;
  name: string;
  barcode: string;
  stock: string;
  price: string;
  active: boolean;
  deleted?: boolean;
};

// EPIC-047 Fase 1A — panel "Matriks Varian" (auto-generate SKU)
type MatrixAxisRow = {
  key: string;
  label: string;
  values: string[];
  custom: boolean;
};

const DEFAULT_MATRIX_AXES: MatrixAxisRow[] = [
  { key: 'ukuran', label: 'Ukuran', values: [], custom: false },
  { key: 'warna', label: 'Warna', values: [], custom: false },
];

function merchStockLabel(product: PosCatalogProduct) {
  const activeSkus = product.merchSkus.filter((sku) => sku.active);
  if (activeSkus.length > 0) {
    return activeSkus.reduce((sum, sku) => sum + sku.stock, 0);
  }
  return product.inventoryQuantity;
}

function inferStation(product: PosCatalogProduct) {
  const explicit = product.station;
  if (explicit) return explicit;
  if (/drink|minuman|kopi|coffee|tea|teh|juice|soda|latte|cappuccino/i.test(`${product.category} ${product.name}`)) {
    return 'bar';
  }
  if (/dessert|cake|kue|roti|bread|pastry|donut|bakery/i.test(`${product.category} ${product.name}`)) {
    return 'bakery';
  }
  return 'kitchen';
}

function formatMarginLabel(margin: number) {
  const hasFraction = Math.abs(margin % 1) > 0.001;
  return `${margin.toFixed(hasFraction ? 2 : 0)}%`;
}

function marginTone(margin: number) {
  if (margin < 0) return 'text-red-600';
  if (margin < 15) return 'text-amber-600';
  return 'text-green-600';
}

export function ProductsPage() {
  const { data: products = [], isLoading: loading, error: queryError } = usePosCatalogProducts();
  const patchProductMutation = usePatchPosProduct();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [savingProductId, setSavingProductId] = useState<string | null>(null);

  const [variantModalProduct, setVariantModalProduct] = useState<PosCatalogProduct | null>(null);
  const [variantModalData, setVariantModalData] = useState<PosProductVariant[]>([]);

  const [modifierModalProduct, setModifierModalProduct] = useState<PosCatalogProduct | null>(null);
  const [modifierModalData, setModifierModalData] = useState<PosProductModifierGroup[]>([]);

  // EPIC-039 Fase A — dialog pengaturan merchandise (tautan purchasing + stok)
  const [merchModalProduct, setMerchModalProduct] = useState<PosCatalogProduct | null>(null);
  const [merchForm, setMerchForm] = useState<MerchFormState>({
    sourceProductId: '',
    stock: '',
    weightGram: '',
    webDistributed: false,
  });
  const [merchSkuRows, setMerchSkuRows] = useState<MerchSkuRow[]>([]);

  // EPIC-047 Fase 1A — panel "Matriks Varian" (auto-generate SKU)
  const [matrixAxes, setMatrixAxes] = useState<MatrixAxisRow[]>(DEFAULT_MATRIX_AXES);
  const [matrixChipDrafts, setMatrixChipDrafts] = useState<Record<string, string>>({});
  const [newAxisName, setNewAxisName] = useState('');
  const [showAddAxis, setShowAddAxis] = useState(false);
  const [matrixPriceOverride, setMatrixPriceOverride] = useState('');
  const [matrixBarcodePrefix, setMatrixBarcodePrefix] = useState('');
  const [matrixGenerating, setMatrixGenerating] = useState(false);
  const [matrixBlocked, setMatrixBlocked] = useState<BlockedSkuMatrixRow[]>([]);

  const [purchasingOptions, setPurchasingOptions] = useState<PurchasingProductOption[]>([]);
  const [purchasingOptionsLoading, setPurchasingOptionsLoading] = useState(false);
  const [localEdits, setLocalEdits] = useState<
    Record<string, Partial<Pick<PosCatalogProduct, 'variants' | 'modifierGroups' | 'hasVariants' | 'hasModifiers'>>>
  >({});

  const queryErrorMessage = queryError instanceof Error ? queryError.message : null;

  useEffect(() => {
    if (queryErrorMessage) {
      toast.error(queryErrorMessage);
    }
  }, [queryErrorMessage]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchTerm(searchQuery.trim());
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const displayProducts = useMemo(
    () => products.map((product) => (localEdits[product.id] ? { ...product, ...localEdits[product.id] } : product)),
    [products, localEdits]
  );

  const categories = useMemo(() => {
    const unique = Array.from(new Set(displayProducts.map((product) => product.category).filter(Boolean)));
    return ['All', ...unique];
  }, [displayProducts]);

  const filteredProducts = displayProducts.filter((product) => {
    const haystack = `${product.name} ${product.sku || ''}`.toLowerCase();
    const matchesSearch = !searchTerm || haystack.includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || product.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const openVariantsModal = (product: PosCatalogProduct) => {
    setVariantModalProduct(product);
    setVariantModalData(product.variants.map((variant) => ({ ...variant })));
  };

  const saveVariants = () => {
    if (!variantModalProduct) return;
    const hasActiveVariants = variantModalData.some((variant) => variant.active);
    setLocalEdits((prev) => ({
      ...prev,
      [variantModalProduct.id]: {
        variants: variantModalData,
        hasVariants: hasActiveVariants,
      },
    }));
    toast.success('Variants saved locally');
    setVariantModalProduct(null);
    setVariantModalData([]);
  };

  const addVariant = () => {
    setVariantModalData((prev) => [
      ...prev,
      { id: generateId(), name: '', sku: '', priceAdj: 0, active: true },
    ]);
  };

  const removeVariant = (id: string) => {
    setVariantModalData((prev) => prev.filter((variant) => variant.id !== id));
  };

  const updateVariant = (id: string, field: keyof PosProductVariant, value: string | number | boolean) => {
    setVariantModalData((prev) =>
      prev.map((variant) => (variant.id === id ? { ...variant, [field]: value } : variant))
    );
  };

  const openModifiersModal = (product: PosCatalogProduct) => {
    setModifierModalProduct(product);
    setModifierModalData(
      product.modifierGroups.map((group) => ({
        ...group,
        modifiers: group.modifiers.map((modifier) => ({ ...modifier })),
      }))
    );
  };

  const saveModifiers = () => {
    if (!modifierModalProduct) return;
    const hasActiveModifiers = modifierModalData.some((group) => group.active);
    setLocalEdits((prev) => ({
      ...prev,
      [modifierModalProduct.id]: {
        modifierGroups: modifierModalData,
        hasModifiers: hasActiveModifiers,
      },
    }));
    toast.success('Modifiers saved locally');
    setModifierModalProduct(null);
    setModifierModalData([]);
  };

  const addModifierGroup = () => {
    setModifierModalData((prev) => [
      ...prev,
      {
        id: generateId(),
        name: '',
        required: false,
        maxSelect: 1,
        active: true,
        modifiers: [],
      },
    ]);
  };

  const removeModifierGroup = (id: string) => {
    setModifierModalData((prev) => prev.filter((group) => group.id !== id));
  };

  const updateModifierGroup = (
    id: string,
    field: keyof PosProductModifierGroup,
    value: string | number | boolean
  ) => {
    setModifierModalData((prev) =>
      prev.map((group) => (group.id === id ? { ...group, [field]: value } : group))
    );
  };

  const addModifier = (groupId: string) => {
    setModifierModalData((prev) =>
      prev.map((group) => {
        if (group.id !== groupId) return group;
        return {
          ...group,
          modifiers: [
            ...group.modifiers,
            { id: generateId(), name: '', priceAdj: 0, active: true },
          ],
        };
      })
    );
  };

  const removeModifier = (groupId: string, modifierId: string) => {
    setModifierModalData((prev) =>
      prev.map((group) => {
        if (group.id !== groupId) return group;
        return {
          ...group,
          modifiers: group.modifiers.filter((modifier) => modifier.id !== modifierId),
        };
      })
    );
  };

  const updateModifier = (
    groupId: string,
    modifierId: string,
    field: keyof PosProductModifier,
    value: string | number | boolean
  ) => {
    setModifierModalData((prev) =>
      prev.map((group) => {
        if (group.id !== groupId) return group;
        return {
          ...group,
          modifiers: group.modifiers.map((modifier) =>
            modifier.id === modifierId ? { ...modifier, [field]: value } : modifier
          ),
        };
      })
    );
  };

  const toggleProductStatus = async (product: PosCatalogProduct, nextActive: boolean) => {
    if (savingProductId) return;

    setSavingProductId(product.id);
    try {
      await patchProductMutation.mutateAsync({
        id: product.id,
        payload: { is_active: nextActive },
      });
      toast.success(`Product ${nextActive ? 'activated' : 'deactivated'} successfully`);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update product status'));
    } finally {
      setSavingProductId(null);
    }
  };

  const updateProductStation = async (id: string, station: string) => {
    if (savingProductId) return;

    setSavingProductId(id);
    try {
      await patchProductMutation.mutateAsync({ id, payload: { station } });
      toast.success('Station updated successfully');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update station'));
    } finally {
      setSavingProductId(null);
    }
  };

  // EPIC-039 Fase A — ganti jenis produk (regular ↔ merchandise)
  const updateProductKind = async (product: PosCatalogProduct, kind: string) => {
    if (savingProductId) return;
    setSavingProductId(product.id);
    try {
      await patchProductMutation.mutateAsync({
        id: product.id,
        payload: { product_kind: kind },
      });
      toast.success(
        kind === 'merchandise'
          ? 'Produk jadi merchandise — atur tautan purchasing & stok lewat tombol stok'
          : 'Produk jadi regular'
      );
    } catch (error) {
      toast.error(getErrorMessage(error, 'Gagal mengganti jenis produk'));
    } finally {
      setSavingProductId(null);
    }
  };

  const openMerchModal = async (product: PosCatalogProduct) => {
    setMerchModalProduct(product);
    setMerchForm({
      sourceProductId: product.sourceProductId ?? '',
      stock: String(product.inventoryQuantity ?? 0),
      weightGram: product.weightGram === null ? '' : String(product.weightGram),
      webDistributed: product.webDistributed,
    });
    setMerchSkuRows(
      product.merchSkus.map((sku) => ({
        rowId: sku.id,
        id: sku.id,
        sku: sku.sku,
        name: sku.name,
        barcode: sku.barcode ?? '',
        stock: String(sku.stock),
        price: sku.priceOverride === null ? '' : String(sku.priceOverride),
        active: sku.active,
      }))
    );
    // EPIC-047 Fase 1A — reset panel Matriks Varian tiap dialog dibuka
    setMatrixAxes(DEFAULT_MATRIX_AXES);
    setMatrixChipDrafts({});
    setNewAxisName('');
    setShowAddAxis(false);
    setMatrixPriceOverride('');
    setMatrixBarcodePrefix('');
    setMatrixBlocked([]);
    if (purchasingOptions.length === 0) {
      setPurchasingOptionsLoading(true);
      try {
        const response = await fetch('/api/purchasing/products?is_active=true&limit=200', {
          cache: 'no-store',
        });
        const json = await response.json();
        const rows = Array.isArray(json?.data) ? json.data : [];
        setPurchasingOptions(
          rows.map((row: PurchasingProductOption) => ({
            id: row.id,
            kode: row.kode,
            nama: row.nama,
          }))
        );
      } catch {
        toast.error('Gagal memuat master purchasing — tautan tetap bisa dikosongkan');
      } finally {
        setPurchasingOptionsLoading(false);
      }
    }
  };

  const addMerchSkuRow = () => {
    setMerchSkuRows((prev) => [
      ...prev,
      {
        rowId: generateId(),
        sku: '',
        name: '',
        barcode: '',
        stock: '0',
        price: '',
        active: true,
      },
    ]);
  };

  const updateMerchSkuRow = (rowId: string, patch: Partial<MerchSkuRow>) => {
    setMerchSkuRows((prev) =>
      prev.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row))
    );
  };

  const removeMerchSkuRow = (rowId: string) => {
    setMerchSkuRows((prev) =>
      prev
        .map((row) =>
          row.rowId === rowId ? (row.id ? { ...row, deleted: true } : null) : row
        )
        .filter((row): row is MerchSkuRow => row !== null)
    );
  };

  // EPIC-047 Fase 1A — panel "Matriks Varian" (chip input per sumbu + generate)
  const matrixActiveAxes = useMemo(
    () => matrixAxes.filter((axis) => axis.values.length > 0),
    [matrixAxes]
  );
  // EPIC-047 security fix (F1) — cap ukuran matriks juga di client, supaya
  // pengguna tidak "kena" 400 dari server tanpa peringatan lebih dulu.
  const matrixSizeCheck = useMemo(
    () => validateMatrixSize(matrixActiveAxes.map((axis) => ({ key: axis.key, values: axis.values }))),
    [matrixActiveAxes]
  );
  // EPIC-047 security fix (S1) — expandMatrix sekarang melempar
  // MatrixTooLargeError kalau dipanggil di atas MAX_COMBOS (self-guard di
  // lib). matrixSizeCheck WAJIB dicek lebih dulu di sini juga, supaya
  // preview di client tidak crash saat pengguna mengetik matriks kebesaran
  // — di atas batas cukup tampilkan 0 kombinasi & pesan error dari
  // matrixSizeCheck (lihat render di bawah).
  const matrixPreviewCombos = useMemo(
    () =>
      matrixSizeCheck.ok
        ? expandMatrix(matrixActiveAxes.map((axis) => ({ key: axis.key, values: axis.values })))
        : [],
    [matrixActiveAxes, matrixSizeCheck]
  );

  const addMatrixAxisValues = (axisKey: string, raw: string) => {
    const parts = raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    setMatrixAxes((prev) =>
      prev.map((axis) => {
        if (axis.key !== axisKey) return axis;
        const seen = new Set(axis.values.map((value) => value.toLowerCase()));
        const nextValues = [...axis.values];
        for (const part of parts) {
          const dedupeKey = part.toLowerCase();
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          nextValues.push(part);
        }
        return { ...axis, values: nextValues };
      })
    );
  };

  const removeMatrixAxisValue = (axisKey: string, value: string) => {
    setMatrixAxes((prev) =>
      prev.map((axis) =>
        axis.key === axisKey ? { ...axis, values: axis.values.filter((v) => v !== value) } : axis
      )
    );
  };

  const handleMatrixChipChange = (axisKey: string, value: string) => {
    if (value.includes(',')) {
      const segments = value.split(',');
      const trailing = segments.pop() ?? '';
      addMatrixAxisValues(axisKey, segments.join(','));
      setMatrixChipDrafts((prev) => ({ ...prev, [axisKey]: trailing }));
    } else {
      setMatrixChipDrafts((prev) => ({ ...prev, [axisKey]: value }));
    }
  };

  const handleMatrixChipKeyDown = (axisKey: string, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addMatrixAxisValues(axisKey, matrixChipDrafts[axisKey] || '');
    setMatrixChipDrafts((prev) => ({ ...prev, [axisKey]: '' }));
  };

  const addCustomMatrixAxis = () => {
    const name = newAxisName.trim();
    if (!name) return;
    const dedupeKey = name.toLowerCase();
    if (matrixAxes.some((axis) => axis.key.toLowerCase() === dedupeKey)) {
      toast.error('Sumbu dengan nama itu sudah ada');
      return;
    }
    setMatrixAxes((prev) => [...prev, { key: name, label: name, values: [], custom: true }]);
    setNewAxisName('');
    setShowAddAxis(false);
  };

  const removeCustomMatrixAxis = (axisKey: string) => {
    setMatrixAxes((prev) => prev.filter((axis) => axis.key !== axisKey));
    setMatrixChipDrafts((prev) => {
      const next = { ...prev };
      delete next[axisKey];
      return next;
    });
  };

  const generateMatrix = async () => {
    if (!merchModalProduct || matrixGenerating) return;
    if (matrixActiveAxes.length === 0 || matrixPreviewCombos.length === 0) {
      toast.error('Isi minimal satu sumbu (mis. Ukuran) dengan nilai sebelum generate');
      return;
    }
    if (!matrixSizeCheck.ok) {
      toast.error(matrixSizeCheck.error);
      return;
    }
    const priceOverrideTrimmed = matrixPriceOverride.trim();
    if (priceOverrideTrimmed !== '' && (!Number.isFinite(Number(priceOverrideTrimmed)) || Number(priceOverrideTrimmed) < 0)) {
      toast.error('Harga override harus angka ≥ 0');
      return;
    }

    setMatrixGenerating(true);
    setMatrixBlocked([]);
    try {
      const result = await createSkuMatrix(merchModalProduct.id, {
        axes: matrixActiveAxes.map((axis) => ({ key: axis.key, values: axis.values })),
        price_override: priceOverrideTrimmed === '' ? null : Number(priceOverrideTrimmed),
        barcode_prefix: matrixBarcodePrefix.trim() || undefined,
      });
      const reactivatedCount = result.reactivated.length;
      toast.success(
        `${result.created.length} SKU dibuat${reactivatedCount > 0 ? `, ${reactivatedCount} diaktifkan kembali` : ''}, ${result.deactivated.length} dinonaktifkan, ${result.kept.length} tidak berubah`
      );
      // Refresh tabel "Varian ber-SKU" dari hasil generate — pola sama
      // dengan openMerchModal saat memuat product.merchSkus.
      setMerchSkuRows(
        result.skus.map((sku) => ({
          rowId: sku.id,
          id: sku.id,
          sku: sku.sku,
          name: sku.name,
          barcode: sku.barcode ?? '',
          stock: String(sku.stock_quantity),
          price:
            sku.price_override === null || sku.price_override === undefined
              ? ''
              : String(sku.price_override),
          active: sku.is_active,
        }))
      );
    } catch (error) {
      if (error instanceof SkuMatrixConflictError) {
        setMatrixBlocked(error.blocked);
        toast.error(error.message);
      } else {
        toast.error(getErrorMessage(error, 'Gagal membuat matriks varian'));
      }
    } finally {
      setMatrixGenerating(false);
    }
  };

  const saveMerchSettings = async () => {
    if (!merchModalProduct || savingProductId) return;
    const stockNumber = Number(merchForm.stock);
    if (!Number.isFinite(stockNumber) || stockNumber < 0) {
      toast.error('Stok harus angka ≥ 0');
      return;
    }
    const weightNumber = merchForm.weightGram.trim() === '' ? null : Number(merchForm.weightGram);
    if (weightNumber !== null && (!Number.isFinite(weightNumber) || weightNumber < 0)) {
      toast.error('Berat harus angka gram ≥ 0');
      return;
    }

    // Validasi baris varian sebelum menyentuh server
    const liveRows = merchSkuRows.filter((row) => !row.deleted);
    for (const row of liveRows) {
      if (!row.sku.trim() || !row.name.trim()) {
        toast.error('Setiap varian wajib punya kode SKU dan nama');
        return;
      }
      if (!Number.isFinite(Number(row.stock))) {
        toast.error(`Stok varian ${row.name || row.sku} harus angka`);
        return;
      }
    }

    setSavingProductId(merchModalProduct.id);
    try {
      // Sinkronkan varian dulu: hapus → ubah/buat (urutan aman utk kode unik)
      for (const row of merchSkuRows) {
        if (row.deleted && row.id) {
          await deleteProductSku(merchModalProduct.id, row.id);
        }
      }
      for (const row of liveRows) {
        const payload = {
          sku: row.sku.trim(),
          name: row.name.trim(),
          barcode: row.barcode.trim() || null,
          price_override: row.price.trim() === '' ? null : Number(row.price),
          stock_quantity: Number(row.stock),
          is_active: row.active,
        };
        if (row.id) {
          await patchProductSku(merchModalProduct.id, row.id, payload);
        } else {
          await createProductSku(merchModalProduct.id, payload);
        }
      }

      // Patch produk terakhir — invalidasi query-nya sekaligus memuat ulang
      // daftar SKU yang baru disinkronkan
      await patchProductMutation.mutateAsync({
        id: merchModalProduct.id,
        payload: {
          source_product_id: merchForm.sourceProductId || null,
          inventory_quantity: stockNumber,
          inventory_tracking: true,
          weight_gram: weightNumber,
          web_distributed: merchForm.webDistributed,
        },
      });

      toast.success('Pengaturan merchandise tersimpan');
      setMerchModalProduct(null);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Gagal menyimpan pengaturan merchandise'));
    } finally {
      setSavingProductId(null);
    }
  };

  // Produk privilege member (EPIC-011 Fase C): syarat min XP; kosong = umum
  const updateProductMinXp = async (id: string, raw: string) => {
    if (savingProductId) return;
    const minXp = raw.trim() === '' ? null : Math.max(0, Math.floor(Number(raw)) || 0) || null;

    setSavingProductId(id);
    try {
      await patchProductMutation.mutateAsync({ id, payload: { min_xp: minXp } });
      toast.success(minXp ? `Syarat member ≥ ${minXp} XP tersimpan` : 'Produk jadi umum (tanpa syarat XP)');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Gagal menyimpan syarat XP'));
    } finally {
      setSavingProductId(null);
    }
  };

  const updateProductSalesChannels = async (product: PosCatalogProduct, presetKey: string) => {
    if (savingProductId) return;
    const preset = SALES_CHANNEL_PRESETS.find((item) => item.key === presetKey);
    if (!preset) return;

    setSavingProductId(product.id);
    try {
      await patchProductMutation.mutateAsync({ id: product.id, payload: { sales_channels: preset.channels } });
      toast.success(`${product.name}: dijual di ${preset.label.toLowerCase()}`);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Gagal menyimpan channel penjualan'));
    } finally {
      setSavingProductId(null);
    }
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSearchTerm('');
    setSelectedCategory('All');
  };

  const hasActiveFilters = searchQuery.trim().length > 0 || selectedCategory !== 'All';

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
                placeholder="Search products..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="h-9 pl-9"
              />
            </div>
            {hasActiveFilters ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetFilters}
                className="h-9 gap-1.5"
              >
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
                  <th className="px-4 py-3 text-left font-semibold">Product</th>
                  <th className="px-4 py-3 text-left font-semibold">Category</th>
                  <th className="px-4 py-3 text-right font-semibold">Selling Price</th>
                  <th className="px-4 py-3 text-right font-semibold">Est. COGS</th>
                  <th className="px-4 py-3 text-right font-semibold">Margin</th>
                  <th className="px-4 py-3 text-left font-semibold">Station</th>
                  <th className="px-4 py-3 text-left font-semibold">Jenis</th>
                  <th className="px-4 py-3 text-right font-semibold">Min XP</th>
                  <th className="px-4 py-3 text-left font-semibold">Dijual di</th>
                  <th className="px-4 py-3 text-center font-semibold">Variants</th>
                  <th className="px-4 py-3 text-center font-semibold">Modifiers</th>
                  <th className="px-4 py-3 text-center font-semibold">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredProducts.map((product) => (
                  <tr key={product.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-gray-200/70">
                          <PosProductThumbnail alt={product.name} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900">{product.name}</p>
                          <p className="text-xs text-gray-400">
                            {product.sku || product.id.slice(0, 8)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{product.category}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {formatAmount(product.price)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-pink-700">
                      {formatAmount(product.cost)}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${marginTone(product.margin)}`}>
                      {formatMarginLabel(product.margin)}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={inferStation(product)}
                        onChange={(event) => updateProductStation(product.id, event.target.value)}
                        disabled={savingProductId === product.id}
                        className="h-9 rounded-lg border border-gray-200/80 bg-white px-3 text-xs font-medium text-gray-700 outline-none transition focus:border-pink-300 focus:ring-1 focus:ring-pink-100 disabled:opacity-50"
                      >
                        {stationOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {product.productKind === 'gift_card' ? (
                        <span className="inline-flex h-9 items-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-700">
                          Gift Card
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <select
                            value={product.productKind}
                            onChange={(event) => updateProductKind(product, event.target.value)}
                            disabled={savingProductId === product.id}
                            className="h-9 rounded-lg border border-gray-200/80 bg-white px-2 text-xs font-medium text-gray-700 outline-none transition focus:border-pink-300 focus:ring-1 focus:ring-pink-100 disabled:opacity-50"
                          >
                            <option value="regular">Regular</option>
                            <option value="merchandise">Merchandise</option>
                          </select>
                          {product.productKind === 'merchandise' ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openMerchModal(product)}
                              className="h-9 gap-1 border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                              title="Stok, tautan purchasing & berat"
                            >
                              <Boxes className="h-3.5 w-3.5" />
                              {merchStockLabel(product)}
                            </Button>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        min={0}
                        defaultValue={product.minXp ?? ''}
                        placeholder="—"
                        title="Syarat privilege member: minimal lifetime XP. Kosongkan utk produk umum."
                        onBlur={(event) => {
                          const raw = event.target.value;
                          const current = product.minXp === null ? '' : String(product.minXp);
                          if (raw.trim() !== current) updateProductMinXp(product.id, raw);
                        }}
                        disabled={savingProductId === product.id}
                        className="h-9 w-20 rounded-lg border border-gray-200/80 bg-white px-2 text-right text-xs font-medium text-gray-700 outline-none transition focus:border-pink-300 focus:ring-1 focus:ring-pink-100 disabled:opacity-50"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={salesChannelPresetKey(product.salesChannels)}
                        onChange={(event) => updateProductSalesChannels(product, event.target.value)}
                        disabled={savingProductId === product.id}
                        title="Channel tempat produk dijual. Hanya GoFood = tidak tampil di kasir & self-order."
                        className="h-9 rounded-lg border border-gray-200/80 bg-white px-2 text-xs font-medium text-gray-700 outline-none disabled:opacity-50"
                      >
                        {SALES_CHANNEL_PRESETS.map((preset) => (
                          <option key={preset.key} value={preset.key}>
                            {preset.label}
                          </option>
                        ))}
                        {salesChannelPresetKey(product.salesChannels) === 'custom' ? (
                          <option value="custom" disabled>
                            {salesChannelSummary(product.salesChannels)}
                          </option>
                        ) : null}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Button
                        type="button"
                        variant={product.hasVariants ? 'outline' : 'ghost'}
                        size="sm"
                        onClick={() => openVariantsModal(product)}
                        className={
                          product.hasVariants
                            ? 'border-pink-200 text-pink-700 hover:bg-pink-50'
                            : 'text-gray-600'
                        }
                      >
                        <Settings2 className="mr-1 h-3.5 w-3.5" />
                        {product.variants.length}
                      </Button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Button
                        type="button"
                        variant={product.hasModifiers ? 'outline' : 'ghost'}
                        size="sm"
                        onClick={() => openModifiersModal(product)}
                        className={
                          product.hasModifiers
                            ? 'border-green-200 text-green-700 hover:bg-green-50'
                            : 'text-gray-600'
                        }
                      >
                        <Sparkles className="mr-1 h-3.5 w-3.5" />
                        {product.modifierGroups.length}
                      </Button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center">
                        <Switch
                          checked={product.status === 'active'}
                          disabled={savingProductId === product.id}
                          onCheckedChange={(checked) => toggleProductStatus(product, checked)}
                          aria-label={`Toggle active status for ${product.name}`}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
          Est. COGS for synced products (SKU PUR-*) is calculated from the latest BOM.
        </div>
      </PurchasingListSection>

      {/* EPIC-039 Fase A — pengaturan merchandise: tautan purchasing, stok, berat */}
      <Dialog open={merchModalProduct !== null} onOpenChange={(open) => !open && setMerchModalProduct(null)}>
        <DialogPanel size="md">
          <DialogPanelHeader>
            <DialogPanelTitle>Pengaturan Merchandise</DialogPanelTitle>
            <DialogPanelDescription>{merchModalProduct?.name}</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="max-h-[65vh] space-y-4 overflow-y-auto">
            <div>
              <label className="mb-1 block text-xs text-gray-500">
                Tautan master purchasing (item barang jadi)
              </label>
              <select
                value={merchForm.sourceProductId}
                onChange={(event) =>
                  setMerchForm((prev) => ({ ...prev, sourceProductId: event.target.value }))
                }
                disabled={purchasingOptionsLoading}
                className="h-10 w-full rounded-lg border border-gray-200/80 bg-white px-3 text-sm text-gray-700 outline-none transition focus:border-pink-300 focus:ring-1 focus:ring-pink-100 disabled:opacity-50"
              >
                <option value="">— Tanpa tautan (stok diisi manual) —</option>
                {purchasingOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.kode ? `${option.kode} — ` : ''}
                    {option.nama || option.id.slice(0, 8)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">
                Bila tertaut, penerimaan barang (GRN) purchasing jalur Product otomatis
                menambah stok produk ini.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-gray-500">
                  Stok saat ini{merchSkuRows.some((row) => !row.deleted) ? ' (diabaikan — pakai stok per varian)' : ''}
                </label>
                <Input
                  type="number"
                  min={0}
                  value={merchForm.stock}
                  disabled={merchSkuRows.some((row) => !row.deleted)}
                  onChange={(event) =>
                    setMerchForm((prev) => ({ ...prev, stock: event.target.value }))
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Berat (gram)</label>
                <Input
                  type="number"
                  min={0}
                  placeholder="utk ongkir toko online"
                  value={merchForm.weightGram}
                  onChange={(event) =>
                    setMerchForm((prev) => ({ ...prev, weightGram: event.target.value }))
                  }
                />
              </div>
            </div>

            {/* EPIC-039 Fase D — distribusi katalog toko online */}
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={merchForm.webDistributed}
                onChange={(event) =>
                  setMerchForm((prev) => ({ ...prev, webDistributed: event.target.checked }))
                }
                className="h-4 w-4 rounded border-gray-300 text-pink-600"
              />
              Tampilkan di toko online (katalog web)
            </label>

            {/* EPIC-047 Fase 1A — Matriks Varian: chip input per sumbu -> auto-generate SKU */}
            {merchModalProduct?.productKind === 'merchandise' ? (
              <div className="space-y-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
                <div className="flex items-center gap-2">
                  <Wand2 className="h-4 w-4 text-indigo-600" />
                  <p className="text-sm font-medium text-gray-700">Matriks Varian</p>
                </div>
                <p className="text-xs text-gray-500">
                  Isi nilai tiap sumbu (mis. Ukuran: S, M, L, XL), lalu Generate untuk membuat
                  SKU otomatis. Generate ulang aman — SKU yang sudah ada tidak diduplikasi, dan
                  SKU ber-stok tidak akan hilang.
                </p>

                {matrixAxes.map((axis) => (
                  <div key={axis.key}>
                    <div className="mb-1 flex items-center justify-between">
                      <label className="text-xs text-gray-500">{axis.label}</label>
                      {axis.custom ? (
                        <button
                          type="button"
                          onClick={() => removeCustomMatrixAxis(axis.key)}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Hapus sumbu
                        </button>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200/80 bg-white p-1.5">
                      {axis.values.map((value) => (
                        <span
                          key={value}
                          className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700"
                        >
                          {value}
                          <button
                            type="button"
                            onClick={() => removeMatrixAxisValue(axis.key, value)}
                            aria-label={`Hapus ${value} dari ${axis.label}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                      <input
                        value={matrixChipDrafts[axis.key] || ''}
                        onChange={(event) => handleMatrixChipChange(axis.key, event.target.value)}
                        onKeyDown={(event) => handleMatrixChipKeyDown(axis.key, event)}
                        onBlur={(event) => {
                          if (!event.target.value.trim()) return;
                          addMatrixAxisValues(axis.key, event.target.value);
                          setMatrixChipDrafts((prev) => ({ ...prev, [axis.key]: '' }));
                        }}
                        placeholder={axis.values.length === 0 ? `${axis.label}, koma/Enter` : ''}
                        className="min-w-[100px] flex-1 border-none px-1 py-0.5 text-xs text-gray-700 outline-none"
                      />
                    </div>
                  </div>
                ))}

                {showAddAxis ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={newAxisName}
                      onChange={(event) => setNewAxisName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addCustomMatrixAxis();
                        }
                      }}
                      placeholder="Nama sumbu (mis. Bahan)"
                      className="h-8 text-xs"
                    />
                    <Button type="button" size="sm" variant="outline" onClick={addCustomMatrixAxis}>
                      Tambah
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setShowAddAxis(false);
                        setNewAxisName('');
                      }}
                    >
                      Batal
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowAddAxis(true)}
                    className="text-xs text-indigo-700"
                  >
                    <PlusCircle className="mr-1 h-3 w-3" />+ sumbu
                  </Button>
                )}

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">
                      Harga override (opsional, semua SKU baru)
                    </label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="ikut harga produk"
                      value={matrixPriceOverride}
                      onChange={(event) => setMatrixPriceOverride(event.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">
                      Prefix barcode (opsional)
                    </label>
                    <Input
                      value={matrixBarcodePrefix}
                      placeholder="mis. 89960"
                      onChange={(event) => setMatrixBarcodePrefix(event.target.value)}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 pt-1">
                  <p className={`text-xs ${matrixSizeCheck.ok ? 'text-gray-500' : 'text-red-600'}`}>
                    {matrixSizeCheck.ok
                      ? `${matrixPreviewCombos.length} SKU akan dibuat/dicek`
                      : matrixSizeCheck.error}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    onClick={generateMatrix}
                    disabled={matrixGenerating || matrixPreviewCombos.length === 0 || !matrixSizeCheck.ok}
                    className="purchasing-main-button"
                  >
                    {matrixGenerating ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Generate
                  </Button>
                </div>

                {matrixBlocked.length > 0 ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                    <p className="mb-1 font-medium">
                      SKU berikut masih ada stoknya — kosongkan dulu sebelum menghapus variannya
                      dari matriks:
                    </p>
                    <ul className="list-disc space-y-0.5 pl-4">
                      {matrixBlocked.map((row) => (
                        <li key={row.id}>
                          {row.sku} — {row.name} (stok {row.stock_quantity})
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* EPIC-039 Fase B — varian ber-SKU: stok/barcode/harga per varian */}
            <div className="space-y-3 border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">Varian ber-SKU</p>
                <Button type="button" variant="outline" size="sm" onClick={addMerchSkuRow}>
                  <PlusCircle className="mr-1 h-3.5 w-3.5" />
                  Tambah Varian
                </Button>
              </div>
              {merchSkuRows.filter((row) => !row.deleted).length === 0 ? (
                <p className="text-xs text-gray-400">
                  Tanpa varian — stok memakai kolom &quot;Stok saat ini&quot; di atas.
                  Tambahkan varian (mis. Merah / L) bila kaos ini punya warna/ukuran.
                </p>
              ) : (
                merchSkuRows
                  .filter((row) => !row.deleted)
                  .map((row) => (
                    <div
                      key={row.rowId}
                      className="space-y-2 rounded-lg border border-gray-200/70 bg-gray-50/80 p-3"
                    >
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs text-gray-500">Nama varian</label>
                          <Input
                            value={row.name}
                            placeholder="Merah / L"
                            onChange={(event) =>
                              updateMerchSkuRow(row.rowId, { name: event.target.value })
                            }
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-gray-500">Kode SKU</label>
                          <Input
                            value={row.sku}
                            placeholder="KAOS-MRH-L"
                            onChange={(event) =>
                              updateMerchSkuRow(row.rowId, { sku: event.target.value })
                            }
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div>
                          <label className="mb-1 block text-xs text-gray-500">Barcode</label>
                          <Input
                            value={row.barcode}
                            placeholder="scan/ketik"
                            onChange={(event) =>
                              updateMerchSkuRow(row.rowId, { barcode: event.target.value })
                            }
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-gray-500">Stok</label>
                          <Input
                            type="number"
                            value={row.stock}
                            onChange={(event) =>
                              updateMerchSkuRow(row.rowId, { stock: event.target.value })
                            }
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-gray-500">Harga (opsional)</label>
                          <Input
                            type="number"
                            min={0}
                            placeholder="ikut harga produk"
                            value={row.price}
                            onChange={(event) =>
                              updateMerchSkuRow(row.rowId, { price: event.target.value })
                            }
                          />
                        </div>
                        <div className="flex items-end gap-1.5 pb-0.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => updateMerchSkuRow(row.rowId, { active: !row.active })}
                            className={row.active ? 'border-green-200 text-green-700' : ''}
                          >
                            {row.active ? 'Aktif' : 'Nonaktif'}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => removeMerchSkuRow(row.rowId)}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMerchModalProduct(null)}>
              Batal
            </Button>
            <Button
              type="button"
              onClick={saveMerchSettings}
              disabled={savingProductId === merchModalProduct?.id}
              className="purchasing-main-button"
            >
              <Save className="mr-2 h-4 w-4" />
              Simpan
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>

      <Dialog open={variantModalProduct !== null} onOpenChange={(open) => !open && setVariantModalProduct(null)}>
        <DialogPanel size="md">
          <DialogPanelHeader>
            <DialogPanelTitle>Manage Variants</DialogPanelTitle>
            <DialogPanelDescription>{variantModalProduct?.name}</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="max-h-[60vh] space-y-4 overflow-y-auto">
            {variantModalData.map((variant, index) => (
              <div key={variant.id} className="space-y-3 rounded-lg border border-gray-200/70 bg-gray-50/80 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-gray-700">Variant {index + 1}</span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => updateVariant(variant.id, 'active', !variant.active)}
                      className={variant.active ? 'border-green-200 text-green-700' : ''}
                    >
                      {variant.active ? 'Active' : 'Inactive'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => removeVariant(variant.id)}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">Name</label>
                    <Input
                      value={variant.name}
                      onChange={(event) => updateVariant(variant.id, 'name', event.target.value)}
                      placeholder="Small"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">SKU</label>
                    <Input
                      value={variant.sku}
                      onChange={(event) => updateVariant(variant.id, 'sku', event.target.value)}
                      placeholder="NF-SM"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">Price Adj.</label>
                    <Input
                      type="number"
                      value={variant.priceAdj}
                      onChange={(event) =>
                        updateVariant(variant.id, 'priceAdj', Number.parseInt(event.target.value, 10) || 0)
                      }
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-400">
                  Final price: {formatAmount((variantModalProduct?.price || 0) + variant.priceAdj)}
                </p>
              </div>
            ))}
            <Button type="button" variant="outline" onClick={addVariant} className="w-full">
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Variant
            </Button>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setVariantModalProduct(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveVariants} className="purchasing-main-button">
              <Save className="mr-2 h-4 w-4" />
              Save
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>

      <Dialog open={modifierModalProduct !== null} onOpenChange={(open) => !open && setModifierModalProduct(null)}>
        <DialogPanel size="lg">
          <DialogPanelHeader>
            <DialogPanelTitle>Manage Modifier Groups</DialogPanelTitle>
            <DialogPanelDescription>{modifierModalProduct?.name}</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="max-h-[60vh] space-y-6 overflow-y-auto">
            {modifierModalData.map((group) => (
              <div key={group.id} className="space-y-4 rounded-lg border border-gray-200/70 bg-gray-50/80 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">Group Name</label>
                      <Input
                        value={group.name}
                        onChange={(event) => updateModifierGroup(group.id, 'name', event.target.value)}
                        placeholder="Sugar Level"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">Max Select</label>
                      <Input
                        type="number"
                        value={group.maxSelect}
                        onChange={(event) =>
                          updateModifierGroup(group.id, 'maxSelect', Number.parseInt(event.target.value, 10) || 1)
                        }
                        min="1"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">Status</label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => updateModifierGroup(group.id, 'active', !group.active)}
                        className={group.active ? 'border-green-200 text-green-700' : ''}
                      >
                        {group.active ? 'Active' : 'Inactive'}
                      </Button>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeModifierGroup(group.id)}
                    className="mt-6 h-8 w-8"
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>

                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={group.required}
                    onChange={(event) => updateModifierGroup(group.id, 'required', event.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-pink-600"
                  />
                  Required (customer must select at least one)
                </label>

                <div className="space-y-2 border-l-2 border-gray-200/80 pl-4">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Modifiers</p>
                  {group.modifiers.map((modifier, modifierIndex) => (
                    <div key={modifier.id} className="flex items-center gap-2">
                      <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                        <Input
                          value={modifier.name}
                          onChange={(event) =>
                            updateModifier(group.id, modifier.id, 'name', event.target.value)
                          }
                          placeholder={`Modifier ${modifierIndex + 1}`}
                        />
                        <Input
                          type="number"
                          value={modifier.priceAdj}
                          onChange={(event) =>
                            updateModifier(
                              group.id,
                              modifier.id,
                              'priceAdj',
                              Number.parseInt(event.target.value, 10) || 0
                            )
                          }
                          placeholder="Price adj."
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => removeModifier(group.id, modifier.id)}
                      >
                        <MinusCircle className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" variant="ghost" size="sm" onClick={() => addModifier(group.id)}>
                    <PlusCircle className="mr-1 h-3 w-3" />
                    Add Modifier
                  </Button>
                </div>
              </div>
            ))}

            <Button type="button" variant="outline" onClick={addModifierGroup} className="w-full">
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Modifier Group
            </Button>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setModifierModalProduct(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveModifiers} className="purchasing-main-button">
              <Save className="mr-2 h-4 w-4" />
              Save
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
