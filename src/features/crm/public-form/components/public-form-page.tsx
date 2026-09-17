"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import {
  HONEYPOT_FIELD,
  UTM_KEYS,
  type PublicFieldDef,
} from "@/lib/crm/public-forms";

export interface PublicFormView {
  slug: string;
  title: string;
  description: string | null;
  fields: PublicFieldDef[];
  submit_label: string;
  success_message: string;
  redirect_url: string | null;
  /** Stempel waktu render dari server — dasar pengukuran lama pengisian. */
  rendered_at: number;
}

const COPYRIGHT_YEAR = new Date().getFullYear();

const ORG_TYPE_LABELS: Record<string, string> = {
  corporate: "Perusahaan",
  sekolah: "Sekolah / Kampus",
  komunitas: "Komunitas",
  "travel-agent": "Travel Agent",
  pemerintah: "Instansi Pemerintah",
  perorangan: "Perorangan",
  lainnya: "Lainnya",
};

/** EPIC-050 T-5.3 — halaman publik poskopi.reddie.id/public. */
export function PublicFormPage({ form }: { form: PublicFormView }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [banner, setBanner] = useState<string | null>(null);

  /**
   * UTM dibaca dari URL saat submit, bukan lewat efek — halaman ini dirender di
   * server lebih dulu, dan membaca di titik kirim menghindari state tambahan.
   */
  const readAttribution = (): Record<string, string> => {
    if (typeof window === "undefined") return {};
    const sp = new URLSearchParams(window.location.search);
    const found: Record<string, string> = {};
    for (const k of UTM_KEYS) {
      const v = sp.get(k);
      if (v) found[k] = v;
    }
    found.landing_page = window.location.href.slice(0, 500);
    if (document.referrer) found.referrer = document.referrer.slice(0, 500);
    return found;
  };

  const set = (key: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: "" } : prev));
  };

  const submit = async () => {
    setStatus("sending");
    setBanner(null);
    try {
      const res = await fetch(`/api/public/crm/forms/${form.slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, ...readAttribution(), form_started_at: form.rendered_at }),
      });
      const body = (await res.json()) as {
        success: boolean;
        error?: string;
        details?: Array<{ key: string; message: string }>;
        data?: { message?: string; redirect_url?: string | null };
      };
      if (!res.ok || !body.success) {
        const fieldErrors: Record<string, string> = {};
        for (const d of body.details ?? []) fieldErrors[d.key] = d.message;
        setErrors(fieldErrors);
        setBanner(body.error ?? "Gagal mengirim. Coba lagi sebentar lagi.");
        setStatus("idle");
        return;
      }
      if (body.data?.redirect_url) {
        window.location.href = body.data.redirect_url;
        return;
      }
      setStatus("sent");
    } catch {
      setBanner("Jaringan bermasalah. Coba lagi sebentar lagi.");
      setStatus("idle");
    }
  };

  const grouped = useMemo(() => form.fields, [form.fields]);

  return (
    <main className="relative min-h-screen bg-[#0d111b]">
      <div className="absolute inset-0">
        <Image src="/bg.avif" alt="" fill priority className="object-cover opacity-25" sizes="100vw" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0d111b]/80 via-[#10182e]/85 to-[#0d111b]/95" />
      </div>

      {/* min-h-dvh, bukan min-h-screen: globals.css punya aturan global
          `.flex.min-h-screen` yang menimpa latar dengan page-mesh terang. */}
      <div className="relative mx-auto flex min-h-dvh max-w-3xl flex-col px-5 py-10 sm:py-16">
        <div className="flex items-center gap-3">
          <Image src="/logos/bcd-coffee-logo.png" alt="BCD Coffee" width={188} height={44} className="h-11 w-auto" priority />
        </div>

        <div className="mt-8 rounded-2xl border border-white/10 bg-white/95 p-6 shadow-2xl backdrop-blur sm:p-8">
          {status === "sent" ? (
            <div className="py-10 text-center">
              <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" />
              <h1 className="mt-4 text-2xl font-bold text-gray-900">Terkirim</h1>
              <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">{form.success_message}</p>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{form.title}</h1>
              {form.description ? <p className="mt-2 text-sm leading-relaxed text-gray-600">{form.description}</p> : null}

              {banner ? (
                <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{banner}</p>
              ) : null}

              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {grouped.map((f) => (
                  <FormField
                    key={f.key}
                    field={f}
                    value={values[f.key]}
                    error={errors[f.key]}
                    onChange={(v) => set(f.key, v)}
                  />
                ))}
              </div>

              {/* Jebakan bot: tersembunyi dari manusia, tapi terisi oleh pengisi otomatis. */}
              <div className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
                <label htmlFor={HONEYPOT_FIELD}>Jangan diisi</label>
                <input
                  id={HONEYPOT_FIELD}
                  name={HONEYPOT_FIELD}
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={String(values[HONEYPOT_FIELD] ?? "")}
                  onChange={(e) => set(HONEYPOT_FIELD, e.target.value)}
                />
              </div>

              <button
                type="button"
                onClick={submit}
                disabled={status === "sending"}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#1d1dcc] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#121296] disabled:opacity-60 sm:w-auto"
              >
                {status === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {form.submit_label}
              </button>
              <p className="mt-3 text-xs text-gray-500">
                Dengan mengirim, Anda setuju dihubungi tim BCD Coffee terkait permintaan ini.
              </p>
            </>
          )}
        </div>

        <p className="mt-auto pt-10 text-center text-xs text-white/50">
          © {COPYRIGHT_YEAR} BCD Coffee
        </p>
      </div>
    </main>
  );
}

function FormField({ field, value, error, onChange }: {
  field: PublicFieldDef;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
}) {
  const base =
    "w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[#1d1dcc] focus:ring-2 focus:ring-[#1d1dcc]/20";
  const border = error ? "border-red-400" : "border-gray-300";
  const span = field.width === 2 ? "sm:col-span-2" : "";
  const id = `f-${field.key}`;

  return (
    <div className={span}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-gray-800">
        {field.label}
        {field.required ? <span className="ml-0.5 text-[#1d1dcc]">*</span> : null}
      </label>

      {field.type === "textarea" ? (
        <textarea id={id} rows={4} className={`${base} ${border}`} placeholder={field.placeholder ?? ""}
          value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      ) : field.type === "select" ? (
        <select id={id} className={`${base} ${border}`} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">Pilih…</option>
          {field.options.map((o) => <option key={o} value={o}>{ORG_TYPE_LABELS[o] ?? o}</option>)}
        </select>
      ) : field.type === "checkbox" ? (
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input id={id} type="checkbox" className="h-4 w-4 rounded border-gray-300 text-[#1d1dcc]"
            checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          {field.help_text ?? "Ya"}
        </label>
      ) : (
        <input
          id={id}
          type={field.type === "email" ? "email" : field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "phone" ? "tel" : "text"}
          inputMode={field.type === "phone" ? "tel" : undefined}
          className={`${base} ${border}`}
          placeholder={field.placeholder ?? ""}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
      {!error && field.help_text && field.type !== "checkbox" ? (
        <p className="mt-1 text-xs text-gray-500">{field.help_text}</p>
      ) : null}
    </div>
  );
}
