"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CompanyProfile } from "../api";
import { useCompanyProfile } from "../queries";
import { useSaveCompanyProfile } from "../mutations";
import { toast } from "sonner";

/**
 * Profil legal perusahaan — dipakai sebagai PIHAK PERTAMA pada PDF surat
 * perjanjian kerja (PKWT/PKWTT). Field kosong dirender sebagai garis isian
 * di dokumen.
 */

const FIELD_DEFS: {
  key: keyof CompanyProfile;
  label: string;
  placeholder: string;
}[] = [
  {
    key: "legal_name",
    label: "Nama legal perusahaan",
    placeholder: "cth. PT NüHabit",
  },
  {
    key: "address",
    label: "Alamat perusahaan",
    placeholder: "cth. Jl. Merdeka No. 1, Bandung",
  },
  {
    key: "city",
    label: "Kota (tempat tanda tangan kontrak)",
    placeholder: "cth. Bandung",
  },
  {
    key: "signer_name",
    label: "Nama penandatangan",
    placeholder: "cth. nama Direktur/HRD",
  },
  {
    key: "signer_title",
    label: "Jabatan penandatangan",
    placeholder: "cth. Direktur",
  },
];

export function CompanyProfileCard() {
  const profileQuery = useCompanyProfile();
  const saveMutation = useSaveCompanyProfile();
  const [edited, setEdited] = useState<Record<string, string> | null>(null);
  const loading = profileQuery.isLoading;
  const saving = saveMutation.isPending;

  const loaded = useMemo(() => {
    const values: Record<string, string> = {};
    for (const field of FIELD_DEFS)
      values[field.key] = profileQuery.data?.[field.key] ?? "";
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
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan");
    }
  }

  return (
    <div className="rounded-xl border border-gray-200/70 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-800">
        Profil Dokumen Kontrak Kerja
      </h3>
      <p className="mt-0.5 text-xs text-gray-500">
        Dipakai sebagai PIHAK PERTAMA pada PDF surat perjanjian kerja
        (PKWT/PKWTT). Field yang kosong dicetak sebagai garis isian.
      </p>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {FIELD_DEFS.map((field) => (
              <div
                key={field.key}
                className={field.key === "address" ? "sm:col-span-2" : ""}
              >
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  {field.label}
                </label>
                <Input
                  value={form[field.key] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(e) =>
                    setEdited({ ...form, [field.key]: e.target.value })
                  }
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Simpan Profil"
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
