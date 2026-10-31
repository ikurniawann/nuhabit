"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CompanyProfileField } from "../api";
import { useCompanyProfile } from "../queries";
import { useDeleteCompanyLogo, useSaveCompanyProfile, useUploadCompanyLogo } from "../mutations";

/**
 * Profil legal perusahaan: kop quotation dan invoice (layar dan PDF), serta
 * PIHAK PERTAMA pada PDF surat perjanjian kerja (PKWT/PKWTT). Field kontrak
 * yang kosong dicetak sebagai garis isian.
 */

interface FieldDef {
  key: CompanyProfileField;
  label: string;
  placeholder: string;
  type?: "email" | "tel";
  wide?: boolean;
}

const LETTERHEAD_FIELDS: FieldDef[] = [
  { key: "legal_name", label: "Nama legal perusahaan", placeholder: "cth. PT NüHabit Indonesia" },
  { key: "npwp", label: "NPWP", placeholder: "cth. 01.234.567.8-901.000" },
  { key: "address", label: "Alamat perusahaan", placeholder: "cth. Jl. Merdeka No. 1, Bandung", wide: true },
  { key: "city", label: "Kota (juga tempat tanda tangan kontrak)", placeholder: "cth. Bandung" },
  { key: "email", label: "Email", placeholder: "cth. halo@nuhabit.id", type: "email" },
  { key: "phone", label: "Telepon", placeholder: "cth. 022 1234 567", type: "tel" },
  { key: "website", label: "Website (opsional)", placeholder: "cth. nuhabit.id" },
];

const SIGNER_FIELDS: FieldDef[] = [
  { key: "signer_name", label: "Nama penandatangan", placeholder: "cth. nama Direktur/HRD" },
  { key: "signer_title", label: "Jabatan penandatangan", placeholder: "cth. Direktur" },
];

const ALL_FIELDS = [...LETTERHEAD_FIELDS, ...SIGNER_FIELDS];
const LOGO_ACCEPT = "image/png,image/jpeg,image/webp";
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Gagal menyimpan");

export function CompanyProfileCard() {
  const profileQuery = useCompanyProfile();
  const saveMutation = useSaveCompanyProfile();
  const uploadMutation = useUploadCompanyLogo();
  const deleteLogoMutation = useDeleteCompanyLogo();
  const fileRef = useRef<HTMLInputElement>(null);
  const [edited, setEdited] = useState<Record<string, string> | null>(null);
  const logoUrl = profileQuery.data?.logo_url ?? null;
  const logoBusy = uploadMutation.isPending || deleteLogoMutation.isPending;

  const loaded = useMemo(() => {
    const values: Record<string, string> = {};
    for (const field of ALL_FIELDS) values[field.key] = profileQuery.data?.[field.key] ?? "";
    return values;
  }, [profileQuery.data]);
  const form = edited ?? loaded;

  useEffect(() => {
    if (profileQuery.isError) toast.error("Gagal memuat profil perusahaan");
  }, [profileQuery.isError]);

  async function handleSave() {
    try {
      await saveMutation.mutateAsync(form);
      toast.success("Profil perusahaan tersimpan");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function handleLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > LOGO_MAX_BYTES) {
      toast.error("Logo maksimal 2 MB");
      return;
    }
    try {
      await uploadMutation.mutateAsync(file);
      toast.success("Logo tersimpan");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function handleRemoveLogo() {
    try {
      await deleteLogoMutation.mutateAsync();
      toast.success("Logo dihapus; kop kembali memakai logo merek");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const renderField = (field: FieldDef) => (
    <div key={field.key} className={field.wide ? "sm:col-span-2" : ""}>
      <label htmlFor={`company-${field.key}`} className="mb-1 block text-xs font-medium text-gray-600">
        {field.label}
      </label>
      <Input
        id={`company-${field.key}`}
        type={field.type ?? "text"}
        value={form[field.key] ?? ""}
        placeholder={field.placeholder}
        onChange={(e) => setEdited({ ...form, [field.key]: e.target.value })}
      />
    </div>
  );

  return (
    <div className="rounded-xl border border-gray-200/70 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-800">Profil Perusahaan &amp; Kop Dokumen</h3>
      <p className="mt-0.5 text-xs text-gray-500">
        Kop quotation dan invoice (layar dan PDF), juga PIHAK PERTAMA pada PDF surat perjanjian kerja
        (PKWT/PKWTT). Field kontrak yang kosong dicetak sebagai garis isian.
      </p>

      {profileQuery.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex h-16 w-44 items-center justify-center rounded-lg bg-surface-2 p-2">
              <Image
                src={logoUrl ?? "/brand/wordmark-black.png"}
                alt={logoUrl ? "Logo kop dokumen" : "Logo merek (bawaan)"}
                width={160}
                height={48}
                unoptimized
                className="max-h-12 w-auto object-contain"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={logoBusy} onClick={() => fileRef.current?.click()}>
                {uploadMutation.isPending ? <Loader2 className="animate-spin" /> : <ImageUp />}
                {logoUrl ? "Ganti logo" : "Unggah logo"}
              </Button>
              {logoUrl ? (
                <Button type="button" variant="ghost" size="sm" disabled={logoBusy} onClick={handleRemoveLogo}>
                  <Trash2 /> Hapus logo
                </Button>
              ) : null}
              <p className="w-full text-xs text-gray-500">PNG/JPG/WebP, maksimal 2 MB. Tanpa logo, kop memakai logo merek.</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={LOGO_ACCEPT}
              onChange={handleLogo}
              className="hidden"
              aria-label="Berkas logo kop dokumen"
            />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">{LETTERHEAD_FIELDS.map(renderField)}</div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">Penandatangan kontrak kerja</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">{SIGNER_FIELDS.map(renderField)}</div>
          <div className="mt-4 flex justify-end">
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan Profil"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
