'use client';

import { PlusCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { newSkuRow, removeSkuRow, type MerchSkuRow } from '../product-rules';

const FIELDS: Array<{ key: 'barcode' | 'stock' | 'price'; label: string; type?: string; placeholder?: string }> = [
  { key: 'barcode', label: 'Barcode', placeholder: 'scan/ketik' },
  { key: 'stock', label: 'Stok', type: 'number' },
  { key: 'price', label: 'Harga (opsional)', type: 'number', placeholder: 'ikut harga produk' },
];

/** EPIC-039 Fase B — varian ber-SKU: stok/barcode/harga per varian. */
export function MerchSkuEditor({ rows, onChange }: { rows: MerchSkuRow[]; onChange: (rows: MerchSkuRow[]) => void }) {
  const live = rows.filter((row) => !row.deleted);
  const update = (rowId: string, patch: Partial<MerchSkuRow>) =>
    onChange(rows.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-3 border-t border-gray-100 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">Varian ber-SKU</p>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, newSkuRow()])}>
          <PlusCircle className="mr-1 h-3.5 w-3.5" />
          Tambah Varian
        </Button>
      </div>
      {live.length === 0 ? (
        <p className="text-xs text-gray-400">
          Tanpa varian — stok memakai kolom &quot;Stok saat ini&quot; di atas. Tambahkan varian (mis. Merah / L) bila kaos ini
          punya warna/ukuran.
        </p>
      ) : (
        live.map((row) => (
          <div key={row.rowId} className="space-y-2 rounded-lg border border-gray-200/70 bg-gray-50/80 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-gray-500">Nama varian</label>
                <Input value={row.name} placeholder="Merah / L" onChange={(e) => update(row.rowId, { name: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Kode SKU</label>
                <Input value={row.sku} placeholder="KAOS-MRH-L" onChange={(e) => update(row.rowId, { sku: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FIELDS.map((field) => (
                <div key={field.key}>
                  <label className="mb-1 block text-xs text-gray-500">{field.label}</label>
                  <Input
                    type={field.type}
                    min={field.key === 'price' ? 0 : undefined}
                    placeholder={field.placeholder}
                    value={row[field.key]}
                    onChange={(e) => update(row.rowId, { [field.key]: e.target.value })}
                  />
                </div>
              ))}
              <div className="flex items-end gap-1.5 pb-0.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => update(row.rowId, { active: !row.active })}
                  className={row.active ? 'border-green-200 text-green-700' : ''}
                >
                  {row.active ? 'Aktif' : 'Nonaktif'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Hapus varian"
                  onClick={() => onChange(removeSkuRow(rows, row.rowId))}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
