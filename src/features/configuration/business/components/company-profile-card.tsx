"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToastContainer, useToast } from "@/components/ui/toast";
import { apiGet, apiPut } from "@/lib/api-client";

/**
 * Profil legal perusahaan — dipakai sebagai PIHAK PERTAMA pada PDF surat
 * perjanjian kerja (PKWT/PKWTT). Field kosong dirender sebagai garis isian
 * di dokumen.
 */

interface CompanyProfile {
  legal_name: string | null;
  address: string | null;
  city: string | null;
  signer_name: string | null;
  signer_title: string | null;
}

const FIELD_DEFS: { key: keyof CompanyProfile; label: string; placeholder: string }[] = [
  { key: "legal_name", label: "Nama legal perusahaan", placeholder: "cth. PT BCD Coffee" },
  { key: "address", label: "Alamat perusahaan", placeholder: "cth. Jl. Merdeka No. 1, Bandung" },
  { key: "city", label: "Kota (tempat tanda tangan kontrak)", placeholder: "cth. Bandung" },
  { key: "signer_name", label: "Nama penandatangan", placeholder: "cth. nama Direktur/HRD" },
  { key: "signer_title", label: "Jabatan penandatangan", placeholder: "cth. Direktur" },
];

export function CompanyProfileCard() {
  const { toasts, showToast, removeToast } = useToast();
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ data: CompanyProfile }>("/api/settings/company-profile")
      .then((res) => {
        if (cancelled) return;
        const values: Record<string, string> = {};
        for (const field of FIELD_DEFS) values[field.key] = res.data[field.key] ?? "";
        setForm(values);
      })
      .catch(() => {
        if (!cancelled) showToast("Gagal memuat profil perusahaan", "error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await apiPut("/api/settings/company-profile", form);
      showToast("Profil perusahaan tersimpan");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal menyimpan", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200/70 bg-white p-5 shadow-sm">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <h3 className="text-sm font-semibold text-gray-800">
        Profil Dokumen Kontrak Kerja
      </h3>
      <p className="mt-0.5 text-xs text-gray-500">
        Dipakai sebagai PIHAK PERTAMA pada PDF surat perjanjian kerja (PKWT/PKWTT).
        Field yang kosong dicetak sebagai garis isian.
      </p>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {FIELD_DEFS.map((field) => (
              <div key={field.key} className={field.key === "address" ? "sm:col-span-2" : ""}>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  {field.label}
                </label>
                <Input
                  value={form[field.key] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan Profil"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
