"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { NumericInput } from "@/components/ui/numeric-input";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { GENERAL_ROUTES } from "@/lib/purchasing/item-routes";
import { ArrowLeft, Loader2, Plus, Trash2, PackageMinus } from "lucide-react";
import { toast } from "sonner";
import { useSupplyInventoryFormData, useSupplyUsageList } from "../queries";
import { useCreateSupplyUsage } from "../mutations";
import type { SupplyUsageItemInput } from "../types";
import { formatDate } from "@/lib/format";

type Line = SupplyUsageItemInput & { key: number };

let lineSeq = 1;
const newLine = (): Line => ({ key: lineSeq++, supply_item_id: "", qty: 1, catatan: "" });

export function SupplyUsagePage() {
  const formData = useSupplyInventoryFormData();
  const usages = useSupplyUsageList();
  const createMutation = useCreateSupplyUsage();

  const [warehouseId, setWarehouseId] = useState("");
  const [tanggal, setTanggal] = useState(() => new Date().toISOString().split("T")[0]);
  const [divisi, setDivisi] = useState("");
  const [keperluan, setKeperluan] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);

  const warehouseOptions = useMemo(
    () => (formData.data?.warehouses ?? []).map((w) => ({ value: w.id, label: w.name })),
    [formData.data]
  );
  const supplyOptions = useMemo(
    () =>
      (formData.data?.supplies ?? []).map((s) => ({
        value: s.id,
        label: s.nama,
        description: s.kode,
      })),
    [formData.data]
  );

  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const handleSubmit = async () => {
    if (!warehouseId) {
      toast.error("Pilih gudang terlebih dahulu");
      return;
    }
    const items = lines
      .filter((l) => l.supply_item_id && l.qty > 0)
      .map((l) => ({ supply_item_id: l.supply_item_id, qty: l.qty, catatan: l.catatan || undefined }));
    if (items.length === 0) {
      toast.error("Tambahkan minimal satu barang dengan qty > 0");
      return;
    }
    try {
      const res = await createMutation.mutateAsync({
        warehouse_id: warehouseId,
        tanggal,
        divisi: divisi || undefined,
        keperluan: keperluan || undefined,
        items,
      });
      toast.success(`Pemakaian ${res.nomor} tercatat`);
      setLines([newLine()]);
      setDivisi("");
      setKeperluan("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan pemakaian");
    }
  };

  const saving = createMutation.isPending;

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Pemakaian Barang Operasional"
        description="Catat pengeluaran/pemakaian barang dari stok (mengurangi saldo)"
        actions={
          <Link href={GENERAL_ROUTES.inventory}>
            <Button variant="outline" className="purchasing-secondary-button">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Ke Stok
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <PackageMinus className="h-4 w-4 text-pink-600" />
                Form Pemakaian
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Gudang <span className="text-red-500">*</span></Label>
                  <Combobox
                    options={warehouseOptions}
                    value={warehouseId}
                    onChange={(v) => setWarehouseId(v || "")}
                    placeholder="Pilih gudang..."
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Tanggal</Label>
                  <Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Divisi / Unit</Label>
                  <Input value={divisi} onChange={(e) => setDivisi(e.target.value)} placeholder="mis. Maintenance" className="h-9 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Keperluan</Label>
                  <Input value={keperluan} onChange={(e) => setKeperluan(e.target.value)} placeholder="untuk apa dipakai" className="h-9 text-sm" />
                </div>
              </div>

              <div className="space-y-3">
                {lines.map((line, idx) => (
                  <div key={line.key} className="grid grid-cols-12 items-end gap-2 rounded-lg border border-gray-200/70 p-3">
                    <div className="col-span-12 space-y-1.5 md:col-span-6">
                      <Label className="text-xs">Barang {idx + 1}</Label>
                      <Combobox
                        options={supplyOptions}
                        value={line.supply_item_id}
                        onChange={(v) => updateLine(line.key, { supply_item_id: v || "" })}
                        placeholder="Pilih barang..."
                        searchPlaceholder="Cari..."
                        emptyMessage="Barang tidak ditemukan"
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="col-span-7 space-y-1.5 md:col-span-3">
                      <Label className="text-xs">Qty</Label>
                      <NumericInput
                        value={line.qty}
                        onValueChange={(v) => updateLine(line.key, { qty: v })}
                        decimalScale={3}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="col-span-4 space-y-1.5 md:col-span-2">
                      <Label className="text-xs">Catatan</Label>
                      <Input
                        value={line.catatan || ""}
                        onChange={(e) => updateLine(line.key, { catatan: e.target.value })}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={lines.length === 1}
                        onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                        className="text-red-500 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLines((prev) => [...prev, newLine()])}
                  className="purchasing-secondary-button"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Tambah Barang
                </Button>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSubmit} disabled={saving} className="purchasing-main-button">
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Simpan Pemakaian
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="xl:col-span-4">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="text-base">Riwayat Pemakaian</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {usages.isLoading ? (
                <div className="py-8 text-center text-sm text-gray-500">Memuat...</div>
              ) : (usages.data ?? []).length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-500">Belum ada pemakaian.</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {(usages.data ?? []).map((u) => (
                    <li key={u.id} className="px-4 py-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-900">{u.nomor}</span>
                        <span className="text-xs text-gray-400">{formatDate(u.tanggal)}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        {u.warehouse_nama || "-"} · {u.total_items} item{u.divisi ? ` · ${u.divisi}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
