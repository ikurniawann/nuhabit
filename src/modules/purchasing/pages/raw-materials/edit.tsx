"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BreadcrumbNav } from "@/modules/purchasing/components/breadcrumb/BreadcrumbNav";
import PurchasingGuard from "@/modules/purchasing/components/auth/PurchasingGuard";
import Link from "next/link";
import { Loader2, AlertCircle } from "lucide-react";
import { COA_OPTIONS } from "@/types/raw-material";

const KATEGORI_LABELS: Record<string, string> = {
  BAHAN_PANGAN: "Bahan Pangan",
  BAHAN_NON_PANGAN: "Bahan Non-Pangan",
  KEMASAN: "Kemasan",
  BAHAN_BAKAR: "Bahan Bakar",
  LAINNYA: "Lainnya",
};

interface Unit { id: string; kode: string; nama: string; }

export default function RawMaterialsEditPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [units, setUnits] = useState<Unit[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    kode: "", nama: "", kategori: "", coa: "", deskripsi: "",
    satuan_besar_id: "", satuan_kecil_id: "", konversi_factor: "1",
    stok_minimum: "0", stok_maximum: "0", shelf_life_days: "",
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [unitsData, materialData] = await Promise.all([
          fetch("/api/purchasing/units?limit=100&is_active=true").then(r => r.json()),
          fetch(`/api/purchasing/raw-materials/${params.id}`).then(r => r.json()),
        ]);

        setUnits(unitsData.data || []);
        if (!materialData || materialData.success === false) {
          setNotFound(true);
          return;
        }
        const m = materialData.data || materialData;
        setForm({
          kode: m.kode || "",
          nama: m.nama || "",
          kategori: m.kategori || "",
          coa: m.coa || "",
          deskripsi: m.deskripsi || "",
          satuan_besar_id: m.satuan_besar_id || m.satuan_besar?.id || "",
          satuan_kecil_id: m.satuan_kecil_id || m.satuan_kecil?.id || "",
          konversi_factor: String(m.konversi_factor ?? 1),
          stok_minimum: String(m.stok_minimum ?? m.minimum_stock ?? 0),
          stok_maximum: String(m.stok_maksimum ?? m.stok_maximum ?? m.maximum_stock ?? 0),
          shelf_life_days: String(m.shelf_life_days ?? ""),
        });
      } catch {
        setNotFound(true);
      } finally {
        setLoadingData(false);
      }
    };

    fetchData();
  }, [params.id]);

  const set = (field: string, value: string) => setForm(f => ({ ...f, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    const payload: Record<string, any> = {
      nama: form.nama,
      kategori: form.kategori,
      satuan_besar_id: form.satuan_besar_id,
      konversi_factor: parseFloat(form.konversi_factor) || 1,
      stok_minimum: parseFloat(form.stok_minimum) || 0,
      stok_maximum: parseFloat(form.stok_maximum) || 0,
    };
    if (form.deskripsi) payload.deskripsi = form.deskripsi;
    if (form.satuan_kecil_id) payload.satuan_kecil_id = form.satuan_kecil_id;
    if (form.shelf_life_days) payload.shelf_life_days = parseInt(form.shelf_life_days);
    payload.coa = form.coa || null;

    try {
      const res = await fetch(`/api/purchasing/raw-materials/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Gagal menyimpan");
      router.push(`/dashboard/items/raw-materials/${params.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PurchasingGuard allowedRoles={["purchasing_manager", "purchasing_admin", "super_admin"]}>
      <div className="space-y-6">
        <BreadcrumbNav items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Purchasing", href: "/dashboard/purchasing" },
          { label: "Bahan Baku", href: "/dashboard/items/raw-materials" },
          { label: params.id, href: `/dashboard/items/raw-materials/${params.id}` },
          { label: "Edit" },
        ]} />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Edit Bahan Baku</h1>
            <p className="text-sm text-gray-500 font-mono">{form.kode || params.id}</p>
          </div>
          <Link href={`/dashboard/items/raw-materials/${params.id}`}>
            <Button variant="ghost">Batal</Button>
          </Link>
        </div>

        {loadingData ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : notFound ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16">
              <AlertCircle className="w-8 h-8 text-red-400" />
              <p className="text-sm text-red-600">Bahan baku tidak ditemukan</p>
              <Link href="/dashboard/items/raw-materials">
                <Button variant="outline">Kembali ke Daftar</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Informasi Dasar</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Kode Bahan</Label>
                  <Input value={form.kode} disabled className="bg-gray-50" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nama">Nama Bahan <span className="text-red-500">*</span></Label>
                  <Input id="nama" value={form.nama} onChange={e => set("nama", e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Kategori <span className="text-red-500">*</span></Label>
                  <Select value={form.kategori} onValueChange={v => set("kategori", v)} required>
                    <SelectTrigger><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(KATEGORI_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>COA (Chart of Accounts)</Label>
                  <Select value={form.coa} onValueChange={v => set("coa", v)}>
                    <SelectTrigger><SelectValue placeholder="Pilih peruntukan" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value=" ">— Tidak ada —</SelectItem>
                      {COA_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-400">Peruntukan: Produksi, R&D, atau Asset Perusahaan</p>
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="deskripsi">Deskripsi</Label>
                  <Textarea id="deskripsi" value={form.deskripsi} onChange={e => set("deskripsi", e.target.value)} rows={2} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Satuan</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Satuan Besar <span className="text-red-500">*</span></Label>
                  <Select value={form.satuan_besar_id} onValueChange={v => set("satuan_besar_id", v)} required>
                    <SelectTrigger><SelectValue placeholder="Pilih satuan besar" /></SelectTrigger>
                    <SelectContent>
                      {units.map(u => <SelectItem key={u.id} value={u.id}>{u.nama} ({u.kode})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Satuan Kecil <span className="text-gray-400 font-normal">(opsional)</span></Label>
                  <Select value={form.satuan_kecil_id} onValueChange={v => set("satuan_kecil_id", v)}>
                    <SelectTrigger><SelectValue placeholder="Pilih satuan kecil" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value=" ">— Tidak ada —</SelectItem>
                      {units.map(u => <SelectItem key={u.id} value={u.id}>{u.nama} ({u.kode})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="konversi">Faktor Konversi</Label>
                  <Input id="konversi" type="number" min="0" step="0.01" value={form.konversi_factor} onChange={e => set("konversi_factor", e.target.value)} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Stok & Penyimpanan</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <Label>Stok Minimum</Label>
                  <Input type="number" min="0" step="0.01" value={form.stok_minimum} onChange={e => set("stok_minimum", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Stok Maksimum</Label>
                  <Input type="number" min="0" step="0.01" value={form.stok_maximum} onChange={e => set("stok_maximum", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Shelf Life (hari)</Label>
                  <Input type="number" min="0" placeholder="—" value={form.shelf_life_days} onChange={e => set("shelf_life_days", e.target.value)} />
                </div>
              </CardContent>
            </Card>

            {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

            <div className="flex justify-end gap-3">
              <Link href={`/dashboard/items/raw-materials/${params.id}`}>
                <Button type="button" variant="outline">Batal</Button>
              </Link>
              <Button type="submit" disabled={saving || !form.nama || !form.kategori || !form.satuan_besar_id}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Simpan Perubahan
              </Button>
            </div>
          </form>
        )}
      </div>
    </PurchasingGuard>
  );
}
