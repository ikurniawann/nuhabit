'use client';

import { useState } from 'react';
import { PlusCircle, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from '@/components/ui/dialog';
import { formatRupiah } from '@/lib/format';
import { generateRowId } from '../product-rules';
import type { PosCatalogProduct, PosProductVariant } from '../types';

/** Editor varian (disimpan lokal di halaman). Render dengan key=product.id agar draf ter-reset. */
export function VariantsDialog({
  product,
  onClose,
  onSave,
}: {
  product: PosCatalogProduct;
  onClose: () => void;
  onSave: (variants: PosProductVariant[]) => void;
}) {
  const [variants, setVariants] = useState(() => product.variants.map((variant) => ({ ...variant })));
  const update = (id: string, patch: Partial<PosProductVariant>) =>
    setVariants((prev) => prev.map((variant) => (variant.id === id ? { ...variant, ...patch } : variant)));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle>Manage Variants</DialogPanelTitle>
          <DialogPanelDescription>{product.name}</DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="max-h-[60vh] space-y-4 overflow-y-auto">
          {variants.map((variant, index) => (
            <div key={variant.id} className="space-y-3 rounded-lg border border-gray-200/70 bg-gray-50/80 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-gray-700">Variant {index + 1}</span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => update(variant.id, { active: !variant.active })}
                    className={variant.active ? 'border-green-200 text-green-700' : ''}
                  >
                    {variant.active ? 'Active' : 'Inactive'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Hapus varian"
                    onClick={() => setVariants((prev) => prev.filter((item) => item.id !== variant.id))}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Name</label>
                  <Input value={variant.name} onChange={(e) => update(variant.id, { name: e.target.value })} placeholder="Small" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">SKU</label>
                  <Input value={variant.sku} onChange={(e) => update(variant.id, { sku: e.target.value })} placeholder="NF-SM" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Price Adj.</label>
                  <Input
                    type="number"
                    value={variant.priceAdj}
                    onChange={(e) => update(variant.id, { priceAdj: Number.parseInt(e.target.value, 10) || 0 })}
                  />
                </div>
              </div>
              <p className="text-xs text-gray-400">Final price: {formatRupiah((product.price || 0) + variant.priceAdj)}</p>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setVariants((prev) => [...prev, { id: generateRowId(), name: '', sku: '', priceAdj: 0, active: true }])
            }
            className="w-full"
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Variant
          </Button>
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onSave(variants)} className="purchasing-main-button">
            <Save className="mr-2 h-4 w-4" />
            Save
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
