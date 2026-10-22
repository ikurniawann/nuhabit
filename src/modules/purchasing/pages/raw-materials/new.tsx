"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BreadcrumbNav } from "@/modules/purchasing/components/breadcrumb/BreadcrumbNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Link from "next/link";
import PurchasingGuard from "@/modules/purchasing/components/auth/PurchasingGuard";
import { COA_OPTIONS } from "@/types/raw-material";
import { Loader2 } from "lucide-react";

const KATEGORI_LABELS: Record<string, string> = {
  BAHAN_PANGAN: "Bahan Pangan",
  BAHAN_NON_PANGAN: "Bahan Non-Pangan",
  KEMASAN: "Kemasan",
  BAHAN_BAKAR: "Bahan Bakar",
  LAINNYA: "Lainnya",
};

interface Unit {
  id: string;
  kode: string;
  nama: string;
}

export default function RawMaterialsNewPage() {
  const router = useRouter();
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    kode: "",
    nama: "",
    kategori: "",
    coa: "",
    deskripsi: "",
    satuan_besar_id: "",
    satuan_kecil_id: "",
    konversi_factor: "1",
    stok_minimum: "0",
    stok_maximum: "0",
    shelf_life_days: "",
  });

  useEffect(() => {
    fetch("/api/purchasing/units?limit=100&is_active=true")
      .then(r => r.json())
      .then(d => setUnits(d.data || []));
  }, []);

  const set = (field: string, value: string) =>
    setForm(f => ({ ...f, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const payload: Record<string, any> = {
      nama: form.nama,
      kategori: form.kategori,
      satuan_besar_id: form.satuan_besar_id,
      konversi_factor: parseFloat(form.konversi_factor) || 1,
      stok_minimum: parseFloat(form.stok_minimum) || 0,
      stok_maximum: parseFloat(form.stok_maximum) || 0,
    };

    if (form.kode) payload.kode = form.kode;
    if (form.deskripsi) payload.deskripsi = form.deskripsi;
    if (form.satuan_kecil_id) payload.satuan_kecil_id = form.satuan_kecil_id;
    if (form.shelf_life_days) payload.shelf_life_days = parseInt(form.shelf_life_days);
    if (form.coa) payload.coa = form.coa;

    try {
      const res = await fetch("/api/purchasing/raw-materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Gagal menyimpan");
      router.push("/dashboard/items/raw-materials");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PurchasingGuard allowedRoles={["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"]}>
      <div className="space-y-6">
        <BreadcrumbNav
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Purchasing", href: "/dashboard/purchasing" },
            { label: "Bahan Baku", href: "/dashboard/items/raw-materials" },
            { label: "Tambah Bahan" },
          ]}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tambah Bahan Baku</h1>
            <p className="text-sm text-gray-500">Formulir bahan baku baru</p>
          </div>
          <Link href="/dashboard/items/raw-materials">
            <Button variant="ghost">Batal</Button>
          </Link>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Informasi Dasar */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Informasi Dasar</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="kode">Kode Bahan <span className="text-gray-400 font-normal">(opsional, otomatis jika kosong)</span></Label>
                <Input
                  id="kode"
                  placeholder="BHN-2026-0001"
                  value={form.kode}
                  onChange={e => set("kode", e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="nama">Nama Bahan <span className="text-red-500">*</span></Label>
                <Input
                  id="nama"
                  placeholder="Nama bahan baku"
                  value={form.nama}
                  onChange={e => set("nama", e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label>Kategori <span className="text-red-500">*</span></Label>
                <Select value={form.kategori} onValueChange={v => set("kategori", v)} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(KATEGORI_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>COA (Chart of Accounts)</Label>
                <Select value={form.coa} onValueChange={v => set("coa", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih peruntukan" />
                  </SelectTrigger>
                  <SelectContent>
                    {COA_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400">Peruntukan bahan: Produksi, R&D, atau Asset Perusahaan</p>
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="deskripsi">Deskripsi</Label>
                <Textarea
                  id="deskripsi"
                  placeholder="Keterangan tambahan"
                  value={form.deskripsi}
                  onChange={e => set("deskripsi", e.target.value)}
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>

          {/* Satuan */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Satuan</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Satuan Besar <span className="text-red-500">*</span></Label>
                <Select value={form.satuan_besar_id} onValueChange={v => set("satuan_besar_id", v)} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih satuan besar" />
                  </SelectTrigger>
                  <SelectContent>
                    {units.map(u => (
                      <SelectItem key={u.id} value={u.id}>{u.nama} ({u.kode})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Satuan Kecil <span className="text-gray-400 font-normal">(opsional)</span></Label>
                <Select value={form.satuan_kecil_id} onValueChange={v => set("satuan_kecil_id", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih satuan kecil" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=" ">— Tidak ada —</SelectItem>
                    {units.map(u => (
                      <SelectItem key={u.id} value={u.id}>{u.nama} ({u.kode})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="konversi">Faktor Konversi</Label>
                <Input
                  id="konversi"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.konversi_factor}
                  onChange={e => set("konversi_factor", e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Stok */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stok & Penyimpanan</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="stok_min">Stok Minimum</Label>
                <Input
                  id="stok_min"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.stok_minimum}
                  onChange={e => set("stok_minimum", e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="stok_max">Stok Maksimum</Label>
                <Input
                  id="stok_max"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.stok_maximum}
                  onChange={e => set("stok_maximum", e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="shelf_life">Shelf Life (hari)</Label>
                <Input
                  id="shelf_life"
                  type="number"
                  min="0"
                  placeholder="—"
                  value={form.shelf_life_days}
                  onChange={e => set("shelf_life_days", e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Link href="/dashboard/items/raw-materials">
              <Button type="button" variant="outline">Batal</Button>
            </Link>
            <Button type="submit" disabled={loading || !form.nama || !form.kategori || !form.satuan_besar_id}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Simpan Bahan Baku
            </Button>
          </div>
        </form>
      </div>
    </PurchasingGuard>
  );
}
