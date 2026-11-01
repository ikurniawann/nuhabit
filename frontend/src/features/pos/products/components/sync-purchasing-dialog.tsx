'use client';

import { useMemo, useState } from 'react';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { purchasingSyncSku } from '../api';
import { useSyncPurchasingProducts } from '../mutations';
import { usePurchasingProductOptions } from '../queries';

/**
 * Pilih barang jadi di master purchasing lalu buat/perbarui produk POS-nya
 * (SKU PUR-<kode>): nama, harga jual, HPP dan kategori ikut master.
 */
export function SyncPurchasingDialog({
  open,
  posSkus,
  onClose,
}: {
  open: boolean;
  /** SKU produk POS yang sudah ada, untuk menandai barang yang sudah tersinkron. */
  posSkus: ReadonlySet<string>;
  onClose: () => void;
}) {
  const options = usePurchasingProductOptions(open);
  const sync = useSyncPurchasingProducts();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = options.data ?? [];
    if (!term) return all;
    return all.filter((row) => `${row.kode ?? ''} ${row.nama ?? ''}`.toLowerCase().includes(term));
  }, [options.data, search]);

  const close = () => {
    if (sync.isPending) return;
    setSearch('');
    setSelected(new Set());
    onClose();
  };

  const toggle = (id: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const submit = () =>
    sync.mutate([...selected], {
      onSuccess: ({ created, updated }) => {
        toast.success(`Sinkron selesai: ${created} produk baru, ${updated} diperbarui`);
        setSelected(new Set());
        onClose();
      },
      onError: (error) => toast.error(error.message),
    });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle>Sinkron dari Purchasing</DialogPanelTitle>
          <DialogPanelDescription>
            Produk POS dibuat atau diperbarui dari master purchasing: nama, harga jual, HPP dan kategori.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              aria-label="Cari barang purchasing"
              placeholder="Cari kode atau nama..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 pl-9"
            />
          </div>
          {options.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" aria-label="Memuat barang purchasing" />
            </div>
          ) : options.error ? (
            <p className="py-6 text-center text-sm text-red-600">Gagal memuat master purchasing</p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">Tidak ada barang purchasing aktif</p>
          ) : (
            <ul className="max-h-80 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-100">
              {rows.map((row) => {
                const label = row.nama || row.kode || row.id;
                return (
                  <li key={row.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50">
                      <Checkbox
                        checked={selected.has(row.id)}
                        onCheckedChange={(checked) => toggle(row.id, checked)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-gray-900">{label}</span>
                        <span className="block text-xs text-gray-500">{purchasingSyncSku(row)}</span>
                      </span>
                      {posSkus.has(purchasingSyncSku(row)) ? <Badge variant="muted">Sudah di POS</Badge> : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogPanelBody>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={sync.isPending}>
            Batal
          </Button>
          <Button onClick={submit} disabled={selected.size === 0 || sync.isPending}>
            {sync.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Sinkronkan{selected.size > 0 ? ` (${selected.size})` : ''}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
