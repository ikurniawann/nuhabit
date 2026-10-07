'use client';

import { useMemo, useState } from 'react';
import { Loader2, PlusCircle, Wand2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { expandMatrix, validateMatrixSize } from '@/lib/pos/merchandise-variants';
import { createSkuMatrix, SkuMatrixConflictError, type BlockedSkuMatrixRow, type SkuMatrixRow } from '../api';
import {
  addAxisValues,
  DEFAULT_MATRIX_AXES,
  matrixResultMessage,
  parseMatrixPrice,
  splitChipDraft,
  type MatrixAxisRow,
} from '../product-rules';

/**
 * EPIC-047 Fase 1A — "Matriks Varian": chip input per sumbu lalu generate SKU.
 * Di-reset tiap dialog dibuka (dialog di-mount ulang per produk).
 */
export function SkuMatrixPanel({
  productId,
  onGenerated,
}: {
  productId: string;
  onGenerated: (skus: SkuMatrixRow[]) => void;
}) {
  const [axes, setAxes] = useState<MatrixAxisRow[]>(DEFAULT_MATRIX_AXES);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newAxisName, setNewAxisName] = useState('');
  const [showAddAxis, setShowAddAxis] = useState(false);
  const [priceOverride, setPriceOverride] = useState('');
  const [barcodePrefix, setBarcodePrefix] = useState('');
  const [generating, setGenerating] = useState(false);
  const [blocked, setBlocked] = useState<BlockedSkuMatrixRow[]>([]);

  const activeAxes = useMemo(
    () => axes.filter((axis) => axis.values.length > 0).map((axis) => ({ key: axis.key, values: axis.values })),
    [axes]
  );
  // Security fix F1/S1: cek ukuran dulu; expandMatrix melempar di atas batas.
  const sizeCheck = useMemo(() => validateMatrixSize(activeAxes), [activeAxes]);
  const comboCount = useMemo(() => (sizeCheck.ok ? expandMatrix(activeAxes).length : 0), [activeAxes, sizeCheck]);

  const setDraft = (axisKey: string, value: string) => setDrafts((prev) => ({ ...prev, [axisKey]: value }));
  const commitValues = (axisKey: string, raw: string) => setAxes((prev) => addAxisValues(prev, axisKey, raw));

  function onChipChange(axisKey: string, value: string) {
    const { commit, draft } = splitChipDraft(value);
    if (commit) commitValues(axisKey, commit);
    setDraft(axisKey, draft);
  }

  function addCustomAxis() {
    const name = newAxisName.trim();
    if (!name) return;
    if (axes.some((axis) => axis.key.toLowerCase() === name.toLowerCase())) {
      toast.error('Sumbu dengan nama itu sudah ada');
      return;
    }
    setAxes((prev) => [...prev, { key: name, label: name, values: [], custom: true }]);
    setNewAxisName('');
    setShowAddAxis(false);
  }

  function removeCustomAxis(axisKey: string) {
    setAxes((prev) => prev.filter((axis) => axis.key !== axisKey));
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[axisKey];
      return next;
    });
  }

  async function generate() {
    if (generating) return;
    if (activeAxes.length === 0 || comboCount === 0) {
      toast.error('Isi minimal satu sumbu (mis. Ukuran) dengan nilai sebelum generate');
      return;
    }
    if (!sizeCheck.ok) {
      toast.error(sizeCheck.error);
      return;
    }
    const price = parseMatrixPrice(priceOverride);
    if (!price.ok) {
      toast.error('Harga override harus angka ≥ 0');
      return;
    }
    setGenerating(true);
    setBlocked([]);
    try {
      const result = await createSkuMatrix(productId, {
        axes: activeAxes,
        price_override: price.value,
        barcode_prefix: barcodePrefix.trim() || undefined,
      });
      toast.success(matrixResultMessage(result));
      onGenerated(result.skus);
    } catch (error) {
      if (error instanceof SkuMatrixConflictError) setBlocked(error.blocked);
      toast.error(error instanceof Error ? error.message : 'Gagal membuat matriks varian');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
      <div className="flex items-center gap-2">
        <Wand2 className="h-4 w-4 text-indigo-600" />
        <p className="text-sm font-medium text-gray-700">Matriks Varian</p>
      </div>
      <p className="text-xs text-gray-500">
        Isi nilai tiap sumbu (mis. Ukuran: S, M, L, XL), lalu Generate untuk membuat SKU otomatis. Generate ulang aman — SKU
        yang sudah ada tidak diduplikasi, dan SKU ber-stok tidak akan hilang.
      </p>

      {axes.map((axis) => (
        <div key={axis.key}>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-gray-500">{axis.label}</span>
            {axis.custom ? (
              <button type="button" onClick={() => removeCustomAxis(axis.key)} className="text-xs text-red-500 hover:underline">
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
                  onClick={() =>
                    setAxes((prev) =>
                      prev.map((a) => (a.key === axis.key ? { ...a, values: a.values.filter((v) => v !== value) } : a))
                    )
                  }
                  aria-label={`Hapus ${value} dari ${axis.label}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <input
              aria-label={`Nilai ${axis.label}`}
              value={drafts[axis.key] || ''}
              onChange={(event) => onChipChange(axis.key, event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                commitValues(axis.key, drafts[axis.key] || '');
                setDraft(axis.key, '');
              }}
              onBlur={(event) => {
                if (!event.target.value.trim()) return;
                commitValues(axis.key, event.target.value);
                setDraft(axis.key, '');
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
                addCustomAxis();
              }
            }}
            placeholder="Nama sumbu (mis. Bahan)"
            className="h-8 text-xs"
          />
          <Button type="button" size="sm" variant="outline" onClick={addCustomAxis}>
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
        <Button type="button" size="sm" variant="ghost" onClick={() => setShowAddAxis(true)} className="text-xs text-indigo-700">
          <PlusCircle className="mr-1 h-3 w-3" />+ sumbu
        </Button>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor="matrix-price" className="mb-1 block text-xs text-gray-500">
            Harga override (opsional, semua SKU baru)
          </label>
          <Input
            id="matrix-price"
            type="number"
            min={0}
            placeholder="ikut harga produk"
            value={priceOverride}
            onChange={(event) => setPriceOverride(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="matrix-barcode" className="mb-1 block text-xs text-gray-500">
            Prefix barcode (opsional)
          </label>
          <Input
            id="matrix-barcode"
            value={barcodePrefix}
            placeholder="mis. 89960"
            onChange={(event) => setBarcodePrefix(event.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <p className={`text-xs ${sizeCheck.ok ? 'text-gray-500' : 'text-red-600'}`}>
          {sizeCheck.ok ? `${comboCount} SKU akan dibuat/dicek` : sizeCheck.error}
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() => void generate()}
          disabled={generating || comboCount === 0 || !sizeCheck.ok}
          className="purchasing-main-button"
        >
          {generating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1.5 h-3.5 w-3.5" />}
          Generate
        </Button>
      </div>

      {blocked.length > 0 ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          <p className="mb-1 font-medium">
            SKU berikut masih ada stoknya — kosongkan dulu sebelum menghapus variannya dari matriks:
          </p>
          <ul className="list-disc space-y-0.5 pl-4">
            {blocked.map((row) => (
              <li key={row.id}>
                {row.sku} — {row.name} (stok {row.stock_quantity})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
