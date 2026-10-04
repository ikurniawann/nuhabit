'use client';

import { Boxes, Settings2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { PosProductThumbnail } from '@/components/pos/PosProductThumbnail';
import { formatRupiah } from '@/lib/format';
import { SALES_CHANNEL_PRESETS, salesChannelPresetKey, salesChannelSummary } from '@/lib/pos/sales-channels';
import {
  formatMarginLabel,
  inferStation,
  marginTone,
  merchStockLabel,
  parseBonusXp,
  STATION_OPTIONS,
} from '../product-rules';
import type { PosCatalogProduct } from '../types';

const controlClass =
  'h-9 rounded-lg border border-gray-200/80 bg-white text-xs font-medium text-gray-700 outline-none transition focus:border-pink-300 focus:ring-1 focus:ring-pink-100 disabled:opacity-50';

export type ProductRowActions = {
  onStationChange: (product: PosCatalogProduct, station: string) => void;
  onKindChange: (product: PosCatalogProduct, kind: string) => void;
  onMinXpChange: (product: PosCatalogProduct, raw: string) => void;
  onBonusXpChange: (product: PosCatalogProduct, raw: string) => void;
  onSalesChannelsChange: (product: PosCatalogProduct, presetKey: string) => void;
  onActiveChange: (product: PosCatalogProduct, active: boolean) => void;
  onOpenMerch: (product: PosCatalogProduct) => void;
  onOpenVariants: (product: PosCatalogProduct) => void;
  onOpenModifiers: (product: PosCatalogProduct) => void;
};

export const PRODUCT_TABLE_HEADERS: Array<{ label: string; align: 'left' | 'right' | 'center' }> = [
  { label: 'Product', align: 'left' },
  { label: 'Category', align: 'left' },
  { label: 'Selling Price', align: 'right' },
  { label: 'Est. COGS', align: 'right' },
  { label: 'Margin', align: 'right' },
  { label: 'Station', align: 'left' },
  { label: 'Jenis', align: 'left' },
  { label: 'Min XP', align: 'right' },
  { label: 'Bonus XP', align: 'right' },
  { label: 'Dijual di', align: 'left' },
  { label: 'Variants', align: 'center' },
  { label: 'Modifiers', align: 'center' },
  { label: 'Active', align: 'center' },
];

export function ProductTableRow({
  product,
  saving,
  actions,
}: {
  product: PosCatalogProduct;
  saving: boolean;
  actions: ProductRowActions;
}) {
  const channelKey = salesChannelPresetKey(product.salesChannels);
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-gray-200/70">
            <PosProductThumbnail alt={product.name} />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-gray-900">{product.name}</p>
            <p className="text-xs text-gray-400">{product.sku || product.id.slice(0, 8)}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-gray-700">{product.category}</td>
      <td className="px-4 py-3 text-right font-medium text-gray-900">{formatRupiah(product.price)}</td>
      <td className="px-4 py-3 text-right font-medium text-pink-700">{formatRupiah(product.cost)}</td>
      <td className={`px-4 py-3 text-right font-medium ${marginTone(product.margin)}`}>{formatMarginLabel(product.margin)}</td>
      <td className="px-4 py-3">
        <select
          aria-label={`Station ${product.name}`}
          value={inferStation(product)}
          onChange={(event) => actions.onStationChange(product, event.target.value)}
          disabled={saving}
          className={`${controlClass} px-3`}
        >
          {STATION_OPTIONS.map((option) => (
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
              aria-label={`Jenis ${product.name}`}
              value={product.productKind}
              onChange={(event) => actions.onKindChange(product, event.target.value)}
              disabled={saving}
              className={`${controlClass} px-2`}
            >
              <option value="regular">Regular</option>
              <option value="merchandise">Merchandise</option>
            </select>
            {product.productKind === 'merchandise' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => actions.onOpenMerch(product)}
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
          aria-label={`Min XP ${product.name}`}
          type="number"
          min={0}
          defaultValue={product.minXp ?? ''}
          placeholder="—"
          title="Syarat privilege member: minimal lifetime XP. Kosongkan utk produk umum."
          onBlur={(event) => {
            const current = product.minXp === null ? '' : String(product.minXp);
            if (event.target.value.trim() !== current) actions.onMinXpChange(product, event.target.value);
          }}
          disabled={saving}
          className={`${controlClass} w-20 px-2 text-right`}
        />
      </td>
      <td className="px-4 py-3 text-right">
        <input
          aria-label={`Bonus XP ${product.name}`}
          type="number"
          min={0}
          defaultValue={product.bonusXp || ''}
          placeholder="0"
          title="Bonus XP per unit untuk member saat order lunas (semua metode bayar)."
          onBlur={(event) => {
            if (parseBonusXp(event.target.value) !== product.bonusXp) actions.onBonusXpChange(product, event.target.value);
          }}
          disabled={saving}
          className={`${controlClass} w-20 px-2 text-right`}
        />
      </td>
      <td className="px-4 py-3">
        <select
          aria-label={`Channel ${product.name}`}
          value={channelKey}
          onChange={(event) => actions.onSalesChannelsChange(product, event.target.value)}
          disabled={saving}
          title="Channel tempat produk dijual. Hanya GoFood = tidak tampil di kasir & self-order."
          className="h-9 rounded-lg border border-gray-200/80 bg-white px-2 text-xs font-medium text-gray-700 outline-none disabled:opacity-50"
        >
          {SALES_CHANNEL_PRESETS.map((preset) => (
            <option key={preset.key} value={preset.key}>
              {preset.label}
            </option>
          ))}
          {channelKey === 'custom' ? (
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
          onClick={() => actions.onOpenVariants(product)}
          className={product.hasVariants ? 'border-pink-200 text-pink-700 hover:bg-pink-50' : 'text-gray-600'}
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
          onClick={() => actions.onOpenModifiers(product)}
          className={product.hasModifiers ? 'border-green-200 text-green-700 hover:bg-green-50' : 'text-gray-600'}
        >
          <Sparkles className="mr-1 h-3.5 w-3.5" />
          {product.modifierGroups.length}
        </Button>
      </td>
      <td className="px-4 py-3 text-center">
        <div className="flex items-center justify-center">
          <Switch
            checked={product.status === 'active'}
            disabled={saving}
            onCheckedChange={(checked) => actions.onActiveChange(product, checked)}
            aria-label={`Toggle active status for ${product.name}`}
          />
        </div>
      </td>
    </tr>
  );
}
