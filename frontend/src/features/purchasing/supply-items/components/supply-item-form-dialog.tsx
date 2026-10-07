"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCreateSupplyItem, useUpdateSupplyItem } from "../mutations";
import type { SupplyItem } from "../types";

interface FormState {
  nama: string;
  kode: string;
  kategori: string;
  satuan_id: string;
  stockable: boolean;
  harga_beli: string;
  stok_minimum: string;
  deskripsi: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  nama: "",
  kode: "",
  kategori: "",
  satuan_id: "",
  stockable: false,
  harga_beli: "",
  stok_minimum: "",
  deskripsi: "",
  is_active: true,
};

function formFromItem(item: SupplyItem | null): FormState {
  if (!item) return EMPTY_FORM;
  return {
    nama: item.nama,
    kode: item.kode,
    kategori: item.kategori ?? "",
    satuan_id: item.satuan_id ?? "",
    stockable: item.stockable,
    harga_beli: String(item.harga_beli ?? ""),
    stok_minimum: item.stok_minimum != null ? String(item.stok_minimum) : "",
    deskripsi: item.deskripsi ?? "",
    is_active: item.is_active,
  };
}

interface SupplyItemFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = tambah barang baru. */
  editing: SupplyItem | null;
  categories: { code: string; nama: string }[];
  units: { id: string; nama: string }[];
}

/** Dialog buat/ubah barang operasional; state form diisi ulang lewat `key` dari induk. */
export function SupplyItemFormDialog({ open, onOpenChange, editing, categories, units }: SupplyItemFormDialogProps) {
  const [form, setForm] = useState<FormState>(() => formFromItem(editing));
  const createMutation = useCreateSupplyItem();
  const updateMutation = useUpdateSupplyItem();
  const saving = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = async () => {
    if (!form.nama.trim()) {
      toast.error("Nama barang wajib diisi");
      return;
    }
    const payload = {
      nama: form.nama.trim(),
      kode: form.kode.trim() || undefined,
      kategori: form.kategori || null,
      satuan_id: form.satuan_id || null,
      stockable: form.stockable,
      harga_beli: Number(form.harga_beli) || 0,
      stok_minimum: form.stockable ? Number(form.stok_minimum) || 0 : 0,
      deskripsi: form.deskripsi.trim() || null,
      is_active: form.is_active,
    };
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, payload });
        toast.success("Barang diperbarui");
      } else {
        await createMutation.mutateAsync(payload);
        toast.success("Barang ditambahkan");
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan");
    }
  };

  return (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="w-[90vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{editing ? "Ubah Barang" : "Tambah Barang Operasional"}</DialogTitle>
        <DialogDescription>ATK, spare part, atau consumable untuk kebutuhan internal.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-700">
            Nama Barang <span className="text-red-500">*</span>
          </label>
          <Input
            value={form.nama}
            onChange={(e) => setForm((f) => ({ ...f, nama: e.target.value }))}
            placeholder="mis. Kertas A4 80gsm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700">Kode</label>
            <Input
              value={form.kode}
              onChange={(e) => setForm((f) => ({ ...f, kode: e.target.value }))}
              placeholder="otomatis bila kosong"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700">Kategori</label>
            <Select
              value={form.kategori || undefined}
              onValueChange={(v) => setForm((f) => ({ ...f, kategori: v }))}
            >
              <SelectTrigger><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.code} value={c.code}>{c.nama}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700">Satuan</label>
            <Select
              value={form.satuan_id || undefined}
              onValueChange={(v) => setForm((f) => ({ ...f, satuan_id: v }))}
            >
              <SelectTrigger><SelectValue placeholder="Pilih satuan" /></SelectTrigger>
              <SelectContent>
                {units.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.nama}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700">Harga Beli (Rp)</label>
            <Input
              type="number"
              min={0}
              value={form.harga_beli}
              onChange={(e) => setForm((f) => ({ ...f, harga_beli: e.target.value }))}
              placeholder="0"
            />
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Dilacak stok?</p>
              <p className="text-xs text-gray-500">
                Aktif = spare part disimpan di gudang; Nonaktif = habis pakai (expense saat diterima)
              </p>
            </div>
            <Switch
              checked={form.stockable}
              onCheckedChange={(v) => setForm((f) => ({ ...f, stockable: v }))}
            />
          </div>
          {form.stockable && (
            <div className="mt-3 space-y-1.5">
              <label className="text-xs font-medium text-gray-700">Stok Minimum</label>
              <Input
                type="number"
                min={0}
                value={form.stok_minimum}
                onChange={(e) => setForm((f) => ({ ...f, stok_minimum: e.target.value }))}
                placeholder="0"
              />
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-700">Deskripsi</label>
          <Textarea
            rows={2}
            value={form.deskripsi}
            onChange={(e) => setForm((f) => ({ ...f, deskripsi: e.target.value }))}
            placeholder="Catatan (opsional)"
            className="resize-none"
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Aktif</span>
          <Switch
            checked={form.is_active}
            onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Batal
        </Button>
        <Button onClick={handleSubmit} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Simpan
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  );
}
