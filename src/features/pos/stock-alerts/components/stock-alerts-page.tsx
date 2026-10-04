'use client';

import { RefreshCw, AlertTriangle, Package, Beaker } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStockAlerts } from '../queries';
import { buildStockAlertTickerSegments, hasCriticalStockAlert } from '../ticker';
import type { ProductAtRiskAlert, RawMaterialAlert, StockAlertsResponse } from '@/lib/pos/stock-alerts-types';
import { VerticalMarqueeList } from './vertical-marquee-list';
import { formatNumber, formatTime } from "@/lib/format";

function formatQty(value: number, unit?: string) {
  const formatted = formatNumber(value, 2);
  return unit ? `${formatted} ${unit}` : formatted;
}

function levelClasses(level: 'critical' | 'warning') {
  return level === 'critical'
    ? 'border-red-500/40 bg-red-950/40'
    : 'border-amber-500/40 bg-amber-950/30';
}

function levelBadge(level: 'critical' | 'warning') {
  return level === 'critical'
    ? 'bg-red-500/20 text-red-300 border-red-500/30'
    : 'bg-amber-500/20 text-amber-300 border-amber-500/30';
}

function StockAlertMarquee({ data }: { data: StockAlertsResponse }) {
  const input = {
    raw_materials: data.raw_materials,
    products_at_risk: data.products_at_risk,
    pos_products: data.pos_products,
  };
  const segments = buildStockAlertTickerSegments(input);
  const critical = hasCriticalStockAlert(input);

  const stripTone = critical
    ? 'bg-red-950/80 border-red-900/50 text-red-200'
    : segments.length > 0
      ? 'bg-amber-950/50 border-amber-900/40 text-amber-200'
      : 'bg-gray-900 border-gray-800 text-gray-400';

  if (segments.length === 0) {
    return (
      <div className={`h-9 shrink-0 border-b px-4 flex items-center ${stripTone}`}>
        <p className="text-xs font-semibold">Semua stok aman</p>
      </div>
    );
  }

  const track = segments.join('  •  ');

  return (
    <div className={`h-9 shrink-0 border-b overflow-hidden ${stripTone}`} aria-live="polite">
      <div className="stock-alerts-marquee flex w-max whitespace-nowrap motion-reduce:hidden">
        <p className="px-4 text-xs font-semibold leading-9">{track}</p>
        <p className="px-4 text-xs font-semibold leading-9" aria-hidden="true">
          {track}
        </p>
      </div>
      <p className="hidden motion-reduce:block truncate px-4 text-xs font-semibold leading-9">{track}</p>
    </div>
  );
}

function RawMaterialCard({ item }: { item: RawMaterialAlert }) {
  const pct = item.min_stock > 0 ? Math.min((item.qty_onhand / item.min_stock) * 100, 100) : 0;

  return (
    <div className={`rounded-xl border p-4 ${levelClasses(item.alert_level)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-white truncate">{item.nama}</p>
          <p className="text-xs text-gray-400 mt-0.5">{item.kode} · {item.kategori}</p>
        </div>
        <span className={`shrink-0 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${levelBadge(item.alert_level)}`}>
          {item.status_stok}
        </span>
      </div>
      <div className="mt-3">
        <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
          <div
            className={`h-full rounded-full ${item.alert_level === 'critical' ? 'bg-red-500' : 'bg-amber-400'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-gray-300 mt-2 font-mono">
          {formatQty(item.qty_onhand, item.satuan)} / min {formatQty(item.min_stock, item.satuan)}
        </p>
      </div>
    </div>
  );
}

function ProductAtRiskCard({ item }: { item: ProductAtRiskAlert }) {
  return (
    <div className={`rounded-xl border p-4 ${levelClasses(item.alert_level)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-white truncate">{item.nama}</p>
          <p className="text-xs text-gray-400 mt-0.5">{item.kode}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-bold text-white">{item.max_servings}</p>
          <p className="text-[10px] text-gray-400 uppercase">porsi tersisa</p>
        </div>
      </div>
      <p className="text-xs text-gray-300 mt-3">
        Pembatas: <span className="text-white font-medium">{item.limiting_ingredient}</span>
      </p>
      <div className="mt-3 space-y-1.5">
        {item.ingredients.slice(0, 3).map((ingredient) => (
          <div key={ingredient.material_id} className="flex items-center justify-between text-xs">
            <span className="text-gray-400 truncate pr-2">{ingredient.material_name}</span>
            <span className={`font-mono shrink-0 ${ingredient.alert_level === 'critical' ? 'text-red-300' : 'text-amber-300'}`}>
              {formatQty(ingredient.qty_available)} / {formatQty(ingredient.required_per_unit)}
            </span>
          </div>
        ))}
        {item.ingredients.length > 3 && (
          <p className="text-[10px] text-gray-500">+{item.ingredients.length - 3} bahan lain</p>
        )}
      </div>
    </div>
  );
}

export function StockAlertsPage() {
  const { data, loading, error, refresh } = useStockAlerts(15000);

  const rawMaterials = data?.raw_materials ?? [];
  const productsAtRisk = data?.products_at_risk ?? [];
  const posProducts = data?.pos_products ?? [];

  return (
    <div className="-m-3 sm:-m-6 min-h-[calc(100vh-3.5rem)] bg-gray-950 text-white flex flex-col overflow-hidden">
      {data ? <StockAlertMarquee data={data} /> : null}

      <header className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-amber-500" />
          <div>
            <h1 className="text-lg font-bold tracking-tight">Stok Alert Display</h1>
            <p className="text-xs text-gray-500">Bahan menipis & produk terdampak BOM</p>
          </div>
          {loading && <RefreshCw className="w-3.5 h-3.5 text-gray-500 animate-spin" />}
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-3 text-xs text-gray-400 mr-2">
            <span>{rawMaterials.length} bahan</span>
            <span>{productsAtRisk.length} produk BOM</span>
            {posProducts.length > 0 && <span>{posProducts.length} POS</span>}
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => void refresh()}
            className="text-gray-400 hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {error && (
        <div className="bg-red-900/30 border-b border-red-800 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <main className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-2">
        <section className="flex flex-col border-b lg:border-b-0 lg:border-r border-gray-800 min-h-0">
          <div className="px-4 py-3 bg-gray-900/50 border-b border-gray-800 flex items-center gap-2">
            <Beaker className="w-4 h-4 text-orange-400" />
            <h2 className="text-sm font-semibold">Bahan Baku Menipis</h2>
            <span className="text-xs text-gray-500 ml-auto">{rawMaterials.length} item</span>
          </div>
          <VerticalMarqueeList>
            {rawMaterials.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-500 py-12">
                <Beaker className="w-12 h-12 mb-3 text-gray-700" />
                <p className="text-sm">Semua bahan baku aman</p>
              </div>
            ) : (
              rawMaterials.map((item) => <RawMaterialCard key={item.id} item={item} />)
            )}
          </VerticalMarqueeList>
        </section>

        <section className="flex flex-col min-h-0">
          <div className="px-4 py-3 bg-gray-900/50 border-b border-gray-800 flex items-center gap-2">
            <Package className="w-4 h-4 text-pink-400" />
            <h2 className="text-sm font-semibold">Produk Terdampak (BOM)</h2>
            <span className="text-xs text-gray-500 ml-auto">{productsAtRisk.length} item</span>
          </div>
          <VerticalMarqueeList>
            {productsAtRisk.length === 0 && posProducts.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-500 py-12">
                <Package className="w-12 h-12 mb-3 text-gray-700" />
                <p className="text-sm">Tidak ada produk terdampak bahan menipis</p>
              </div>
            ) : (
              <>
                {productsAtRisk.map((item) => (
                  <ProductAtRiskCard key={item.product_id} item={item} />
                ))}

                {posProducts.length > 0 && (
                  <div className="pt-4 mt-2 border-t border-gray-800">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                      Stok POS Langsung
                    </p>
                    <div className="space-y-2">
                      {posProducts.map((item) => (
                        <div
                          key={item.id}
                          className={`rounded-lg border px-3 py-2 flex items-center justify-between ${levelClasses(item.alert_level)}`}
                        >
                          <div>
                            <p className="text-sm font-medium text-white">{item.name}</p>
                            <p className="text-xs text-gray-400">{item.sku}</p>
                          </div>
                          <span className="text-xs font-mono text-gray-300">
                            {item.current} / min {item.min}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </VerticalMarqueeList>
        </section>
      </main>

      <footer className="bg-gray-900 border-t border-gray-800 px-4 py-2 flex items-center justify-between text-[10px] text-gray-500">
        <span>
          Auto-refresh 15 detik
          {data?.updated_at
            ? ` · Terakhir ${formatTime(data.updated_at)}`
            : ''}
        </span>
        <span className="font-mono">NüHabit POS · Stok Alert</span>
      </footer>
    </div>
  );
}
