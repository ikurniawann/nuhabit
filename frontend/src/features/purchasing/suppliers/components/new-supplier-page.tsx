"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { Loader2, Building2, User, FileText, Phone, Save } from "lucide-react";
import {
  SupplierFormData,
  PaymentTerms,
  Currency,
  PAYMENT_TERMS_OPTIONS,
  CURRENCY_OPTIONS,
  KOTA_OPTIONS,
  formatNPWP,
  validateNPWP,
} from "@/types/supplier";
import {
  PurchasingFormHeader,
} from "@/features/purchasing/components/shared/purchasing-page-header";
import { RM_ROUTES } from "@/lib/purchasing/item-routes";
import { useCreateSupplier } from "../mutations";
import { toast } from "sonner";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function NewSupplierPage() {
  const router = useRouter();
  const createMutation = useCreateSupplier();
  const loading = createMutation.isPending;

  const [formData, setFormData] = useState({
    nama_supplier: "",
    kode_supplier: "",
    kota: "",
    alamat: "",
    telepon: "",
    email: "",
    pic_name: "",
    pic_phone: "",
    pic_email: "",
    payment_terms: "TOP30" as PaymentTerms,
    currency: "IDR" as Currency,
    npwp: "",
    catatan: "",
  });

  const handleSubmit = async (e: React.FormEvent, saveAsDraft = false) => {
    e.preventDefault();

    if (!formData.nama_supplier.trim()) {
      toast.error("Nama supplier wajib diisi.");
      return;
    }

    if (!saveAsDraft && !formData.kota) {
      toast.error("Nama supplier dan kota wajib diisi.");
      return;
    }

    if (formData.npwp && !validateNPWP(formData.npwp)) {
      toast.error("Format NPWP tidak valid. Gunakan: XX.XXX.XXX.X-XXX.XXX");
      return;
    }

    const payload: SupplierFormData & { status: string } = {
      nama_supplier: formData.nama_supplier,
      kota: formData.kota,
      payment_terms: formData.payment_terms,
      currency: formData.currency,
      status: saveAsDraft ? "draft" : "active",
    };

    if (formData.kode_supplier?.trim()) payload.kode_supplier = formData.kode_supplier.trim();
    if (formData.pic_name?.trim()) payload.pic_name = formData.pic_name.trim();
    if (formData.pic_phone?.trim()) payload.pic_phone = formData.pic_phone.trim();
    if (formData.pic_email?.trim()) payload.pic_email = formData.pic_email.trim();
    if (formData.telepon?.trim()) payload.telepon = formData.telepon.trim();
    if (formData.email?.trim()) payload.email = formData.email.trim();
    if (formData.alamat?.trim()) payload.alamat = formData.alamat.trim();
    if (formData.npwp?.trim()) payload.npwp = formData.npwp.trim();
    if (formData.catatan?.trim()) payload.catatan = formData.catatan.trim();

    try {
      await createMutation.mutateAsync(payload);
      toast.success(saveAsDraft ? "Draf supplier berhasil disimpan." : "Supplier berhasil dibuat.");
      router.push(RM_ROUTES.purchasingSuppliers);
    } catch (error: unknown) {
      console.error("Error creating supplier:", error);
      toast.error(getErrorMessage(error, "Gagal membuat supplier."));
    }
  };

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={RM_ROUTES.purchasingSuppliers}
        title="Tambah Supplier"
        description="Masukkan detail untuk data supplier baru."
      />

      <form id="supplier-form" onSubmit={(e) => handleSubmit(e, false)}>
        <div className="space-y-6">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4" />
                Informasi Supplier
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="kode" className="text-xs">Kode Supplier</Label>
                  <Input
                    id="kode"
                    value={formData.kode_supplier}
                    onChange={(e) => setFormData({ ...formData, kode_supplier: e.target.value })}
                    placeholder="Dibuat otomatis"
                    className="h-9 bg-gray-50 text-sm"
                    disabled
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="kota" className="text-xs">
                    Kota <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={KOTA_OPTIONS.map((k) => ({ value: k, label: k }))}
                    value={formData.kota}
                    onChange={(v) => setFormData({ ...formData, kota: v })}
                    placeholder="Pilih kota..."
                    searchPlaceholder="Cari..."
                    emptyMessage="Kota tidak ditemukan"
                    allowClear
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="nama" className="text-xs">
                  Nama Supplier <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="nama"
                  value={formData.nama_supplier}
                  onChange={(e) => setFormData({ ...formData, nama_supplier: e.target.value })}
                  placeholder="Contoh: PT Sari Laut"
                  required
                  className="h-9 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="alamat" className="text-xs">Alamat Lengkap</Label>
                <Textarea
                  id="alamat"
                  value={formData.alamat}
                  onChange={(e) => setFormData({ ...formData, alamat: e.target.value })}
                  placeholder="Nama jalan, kota"
                  rows={2}
                  className="resize-none text-sm"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Phone className="h-4 w-4" />
                Kontak Supplier
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="telepon" className="text-xs">Telepon</Label>
                  <Input
                    id="telepon"
                    value={formData.telepon}
                    onChange={(e) => setFormData({ ...formData, telepon: e.target.value })}
                    placeholder="021-xxxxxxx"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="info@supplier.com"
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4" />
                Narahubung
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pic_name" className="text-xs">Nama Narahubung</Label>
                  <Input
                    id="pic_name"
                    value={formData.pic_name}
                    onChange={(e) => setFormData({ ...formData, pic_name: e.target.value })}
                    placeholder="Nama lengkap"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pic_phone" className="text-xs">Telepon Narahubung</Label>
                  <Input
                    id="pic_phone"
                    value={formData.pic_phone}
                    onChange={(e) => setFormData({ ...formData, pic_phone: e.target.value })}
                    placeholder="08xx-xxxx-xxxx"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pic_email" className="text-xs">Email Narahubung</Label>
                  <Input
                    id="pic_email"
                    type="email"
                    value={formData.pic_email}
                    onChange={(e) => setFormData({ ...formData, pic_email: e.target.value })}
                    placeholder="contact@supplier.com"
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Termin Pembayaran & Administrasi
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="payment_terms" className="text-xs">
                    Termin Pembayaran <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={PAYMENT_TERMS_OPTIONS.map((pt) => ({ value: pt, label: pt }))}
                    value={formData.payment_terms}
                    onChange={(v) => setFormData({ ...formData, payment_terms: v as PaymentTerms })}
                    placeholder="Pilih termin..."
                    searchPlaceholder="Cari..."
                    emptyMessage="Tidak ditemukan"
                    allowClear
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="currency" className="text-xs">
                    Mata Uang <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={CURRENCY_OPTIONS.map((c) => ({ value: c, label: c }))}
                    value={formData.currency}
                    onChange={(v) => setFormData({ ...formData, currency: v as Currency })}
                    placeholder="Pilih mata uang..."
                    searchPlaceholder="Cari..."
                    emptyMessage="Tidak ditemukan"
                    allowClear
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="npwp" className="text-xs">NPWP</Label>
                <Input
                  id="npwp"
                  value={formData.npwp}
                  onChange={(e) => setFormData({ ...formData, npwp: formatNPWP(e.target.value) })}
                  placeholder="XX.XXX.XXX.X-XXX.XXX"
                  maxLength={20}
                  className="h-9 font-mono text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="catatan" className="text-xs">Catatan Tambahan</Label>
                <Textarea
                  id="catatan"
                  value={formData.catatan}
                  onChange={(e) => setFormData({ ...formData, catatan: e.target.value })}
                  placeholder="Informasi tambahan tentang supplier ini..."
                  rows={3}
                  className="resize-none text-sm"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 border-t border-gray-200/70 pt-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={loading}
            className="purchasing-secondary-button w-full sm:w-auto"
          >
            Batal
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={(e) => handleSubmit(e, true)}
            disabled={loading}
            className="purchasing-secondary-button w-full sm:w-auto"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Menyimpan...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Simpan Draft
              </>
            )}
          </Button>
          <Button
            type="submit"
            disabled={loading}
            className="purchasing-main-button w-full sm:w-auto"
          >
            {loading ? "Menyimpan..." : "Simpan Supplier"}
          </Button>
        </div>
      </form>
    </div>
  );
}
