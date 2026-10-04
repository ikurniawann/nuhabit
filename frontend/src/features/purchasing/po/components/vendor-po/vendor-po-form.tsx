"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Package, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { DsDateTimePicker } from "@/components/design-system";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiah } from "@/lib/format";
import { todayIsoDate } from "@/lib/purchasing/po-ui-detail";
import { computePoTotals } from "@/lib/purchasing/po-totals";

export interface VendorPOFormRow {
  qty_ordered: number;
  harga_satuan: number;
  unit_name?: string;
}

/** Header PO ke vendor; diskon nominal tidak dipakai di form ini (selalu 0). */
export interface VendorPOHeaderInput {
  vendor_id: string;
  pr_id?: string;
  tanggal_po: string;
  tanggal_kirim_estimasi?: string;
  catatan?: string;
  alamat_pengiriman?: string;
  diskon_persen: number;
  diskon_nominal: number;
  ppn_persen: number;
}

interface VendorPOFormProps<Row extends VendorPOFormRow> {
  vendors: { id: string; name: string; code: string }[];
  approvedPRs: { id: string; pr_number: string; department_name?: string | null }[];
  initialPRId?: string;
  initialItems: Row[];
  emptyItem: () => Row;
  /** Baris item dari PR terpilih; null bila PR tidak punya item (baris yang ada dipertahankan). */
  itemsFromPR: (prId: string) => Row[] | null;
  /** Kolom pemilih barang/produk (lebar 4 kolom) untuk satu baris. */
  renderPicker: (row: Row, setRow: (row: Row) => void) => ReactNode;
  renderExtra?: (row: Row, setRow: (row: Row) => void) => ReactNode;
  validate: (vendorId: string, items: Row[]) => string | null;
  onSubmit: (header: VendorPOHeaderInput, items: Row[]) => Promise<void>;
  isLoading: boolean;
  cancelHref: string;
}

export function VendorPOForm<Row extends VendorPOFormRow>({
  vendors,
  approvedPRs,
  initialPRId,
  initialItems,
  emptyItem,
  itemsFromPR,
  renderPicker,
  renderExtra,
  validate,
  onSubmit,
  isLoading,
  cancelHref,
}: VendorPOFormProps<Row>) {
  const router = useRouter();
  const [vendorId, setVendorId] = useState("");
  const [prId, setPrId] = useState(initialPRId || "");
  const [tanggalPo, setTanggalPo] = useState(todayIsoDate);
  const [tanggalKirim, setTanggalKirim] = useState("");
  const [catatan, setCatatan] = useState("");
  const [alamat, setAlamat] = useState("");
  const [diskonPersen, setDiskonPersen] = useState(0);
  const [ppnPersen, setPpnPersen] = useState(11);
  const [items, setItems] = useState<Row[]>(initialItems);

  const subtotal = items.reduce((sum, item) => sum + (item.qty_ordered || 0) * (item.harga_satuan || 0), 0);
  const totals = computePoTotals(subtotal, { diskon_persen: diskonPersen, diskon_nominal: 0, ppn_persen: ppnPersen });
  const setRow = (index: number) => (row: Row) => setItems((prev) => prev.map((r, i) => (i === index ? row : r)));

  const handlePRChange = (nextPrId: string) => {
    setPrId(nextPrId);
    const prItems = nextPrId ? itemsFromPR(nextPrId) : null;
    if (prItems?.length) setItems(prItems);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid = validate(vendorId, items);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    await onSubmit(
      {
        vendor_id: vendorId,
        pr_id: prId || undefined,
        tanggal_po: tanggalPo,
        tanggal_kirim_estimasi: tanggalKirim || undefined,
        catatan: catatan.trim() || undefined,
        alamat_pengiriman: alamat.trim() || undefined,
        diskon_persen: diskonPersen,
        diskon_nominal: 0,
        ppn_persen: ppnPersen,
      },
      items
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-8">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Informasi Order
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 pt-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Vendor <span className="text-red-500">*</span>
                </Label>
                <Combobox
                  options={vendors.map((v) => ({ value: v.id, label: v.name, description: v.code }))}
                  value={vendorId}
                  onChange={setVendorId}
                  placeholder="Pilih vendor..."
                  searchPlaceholder="Cari vendor..."
                  emptyMessage="Vendor tidak ditemukan"
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Sumber Permintaan Barang</Label>
                <Combobox
                  options={approvedPRs.map((pr) => ({
                    value: pr.id,
                    label: pr.pr_number,
                    description: pr.department_name || undefined,
                  }))}
                  value={prId}
                  onChange={handlePRChange}
                  placeholder="Opsional, pilih PR disetujui..."
                  searchPlaceholder="Cari PR..."
                  emptyMessage="Tidak ada PR disetujui"
                  allowClear
                  className="h-9 text-sm"
                />
              </div>
              <DsDateTimePicker label="Tanggal PO" value={tanggalPo} onChange={setTanggalPo} dateOnly />
              <DsDateTimePicker label="Estimasi Kirim" value={tanggalKirim} onChange={setTanggalKirim} dateOnly />
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs">Alamat Pengiriman</Label>
                <Textarea value={alamat} onChange={(e) => setAlamat(e.target.value)} rows={2} className="text-sm" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4" />
                Item Order
              </CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={() => setItems((prev) => [...prev, emptyItem()])}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Tambah Item
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {items.map((item, index) => (
                <div key={index} className="rounded-xl border border-gray-200/70 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-medium">Item {index + 1}</p>
                    {items.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-red-500"
                        onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-4 md:grid-cols-12">
                    <div className="space-y-1.5 md:col-span-4">{renderPicker(item, setRow(index))}</div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label className="text-xs">Jumlah</Label>
                      <NumericInput
                        value={item.qty_ordered}
                        onValueChange={(value) => setRow(index)({ ...item, qty_ordered: value || 1 })}
                        decimalScale={4}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label className="text-xs">Satuan</Label>
                      <div className="flex h-9 items-center rounded-lg border border-gray-200/80 bg-gray-50 px-2.5 text-sm">
                        {item.unit_name || "-"}
                      </div>
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label className="text-xs">Harga Satuan</Label>
                      <NumericInput
                        value={item.harga_satuan}
                        onValueChange={(value) => setRow(index)({ ...item, harga_satuan: value || 0 })}
                        decimalScale={0}
                        prefix="Rp"
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3 md:col-span-2">
                      <p className="text-xs text-gray-500">Subtotal</p>
                      <p className="text-sm font-semibold">
                        {formatRupiah((item.qty_ordered || 0) * (item.harga_satuan || 0))}
                      </p>
                    </div>
                    {renderExtra?.(item, setRow(index))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="xl:col-span-4">
          <Card className="border-gray-200/70 shadow-xs xl:sticky xl:top-6">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="text-base">Ringkasan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Diskon %</Label>
                  <NumericInput
                    value={diskonPersen}
                    onValueChange={(value) => setDiskonPersen(value || 0)}
                    decimalScale={2}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">PPN %</Label>
                  <NumericInput
                    value={ppnPersen}
                    onValueChange={(value) => setPpnPersen(value || 0)}
                    decimalScale={2}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Catatan</Label>
                <Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={3} className="text-sm" />
              </div>
              <div className="space-y-2 rounded-xl border border-gray-200/70 bg-gray-50/70 p-4 text-sm">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{formatRupiah(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Diskon</span>
                  <span>{formatRupiah(totals.diskon_nominal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>PPN</span>
                  <span>{formatRupiah(totals.ppn_nominal)}</span>
                </div>
                <div className="flex justify-between border-t border-gray-200/70 pt-2 font-semibold">
                  <span>Total</span>
                  <span>{formatRupiah(totals.total)}</span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Button type="button" variant="outline" onClick={() => router.push(cancelHref)} disabled={isLoading}>
                  Batal
                </Button>
                <Button type="submit" className="purchasing-main-button" disabled={isLoading}>
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Simpan Purchase Order
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}
