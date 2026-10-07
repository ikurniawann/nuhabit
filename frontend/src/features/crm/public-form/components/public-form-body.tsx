"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { HONEYPOT_FIELD, readPageAttribution, type PublicFieldDef } from "@/lib/crm/public-forms";

/** Definisi form seperti dijawab GET /api/public/crm/forms/<slug>. */
export interface PublicFormDefinition {
  slug: string;
  title: string;
  description: string | null;
  fields: PublicFieldDef[];
  submit_label: string;
  success_message: string;
  redirect_url: string | null;
}

const ORG_TYPE_LABELS: Record<string, string> = {
  corporate: "Perusahaan",
  sekolah: "Sekolah / Kampus",
  komunitas: "Komunitas",
  "travel-agent": "Travel Agent",
  pemerintah: "Instansi Pemerintah",
  perorangan: "Perorangan",
  lainnya: "Lainnya",
};

/**
 * Isi form publik CRM tanpa bingkai halaman: field, jebakan bot, tombol kirim
 * dan pesan sukses. `startedAt` adalah stempel waktu render (dasar ukur lama
 * pengisian untuk anti-bot).
 */
export function PublicFormBody({ form, startedAt, onSubmitted }: {
  form: PublicFormDefinition;
  startedAt: number;
  onSubmitted?: () => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [banner, setBanner] = useState<string | null>(null);

  const set = (key: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: "" } : prev));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setBanner(null);
    try {
      const res = await fetch(`/api/public/crm/forms/${form.slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, ...readPageAttribution(), form_started_at: startedAt }),
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
      onSubmitted?.();
    } catch {
      setBanner("Jaringan bermasalah. Coba lagi sebentar lagi.");
      setStatus("idle");
    }
  };

  if (status === "sent") {
    return (
      <div className="py-10 text-center" role="status">
        <CheckCircle2 className="mx-auto h-14 w-14 text-forest" />
        <p className="mt-4 text-2xl font-bold text-foreground">Terkirim</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{form.success_message}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      {banner ? (
        <p className="mb-4 rounded-2xl bg-danger-soft px-4 py-2.5 text-sm text-danger" role="alert">{banner}</p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {form.fields.map((f) => (
          <FormField key={f.key} field={f} value={values[f.key]} error={errors[f.key]} onChange={(v) => set(f.key, v)} />
        ))}
      </div>

      {/* Jebakan bot: tersembunyi dari manusia, tapi terisi oleh pengisi otomatis. */}
      <div className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor={`${form.slug}-${HONEYPOT_FIELD}`}>Jangan diisi</label>
        <input
          id={`${form.slug}-${HONEYPOT_FIELD}`}
          name={HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={String(values[HONEYPOT_FIELD] ?? "")}
          onChange={(e) => set(HONEYPOT_FIELD, e.target.value)}
        />
      </div>

      <Button type="submit" variant="primary" size="lg" disabled={status === "sending"} className="mt-6 w-full sm:w-auto">
        {status === "sending" ? <Loader2 className="animate-spin" /> : <Send />}
        {form.submit_label}
      </Button>
      <p className="mt-3 text-xs text-muted-foreground">
        Dengan mengirim, Anda setuju dihubungi tim NüHabit terkait permintaan ini.
      </p>
    </form>
  );
}

function FormField({ field, value, error, onChange }: {
  field: PublicFieldDef;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
}) {
  const id = `f-${field.key}`;
  const invalid = Boolean(error);
  const span = field.width === 2 ? "sm:col-span-2" : "";
  const inputType =
    field.type === "email" ? "email" : field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "phone" ? "tel" : "text";

  return (
    <div className={span}>
      <Label htmlFor={id} className="mb-1.5 text-foreground">
        {field.label}
        {field.required ? <span className="text-forest">*</span> : null}
      </Label>

      {field.type === "textarea" ? (
        <Textarea id={id} rows={4} placeholder={field.placeholder ?? ""} aria-invalid={invalid}
          value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      ) : field.type === "select" ? (
        <select
          id={id}
          aria-invalid={invalid}
          className="h-11 w-full rounded-2xl border border-border bg-card px-4 text-sm text-foreground outline-none focus-visible:border-forest focus-visible:ring-2 focus-visible:ring-forest/20 aria-invalid:border-destructive"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Pilih…</option>
          {field.options.map((o) => <option key={o} value={o}>{ORG_TYPE_LABELS[o] ?? o}</option>)}
        </select>
      ) : field.type === "checkbox" ? (
        <label className="inline-flex items-center gap-2 text-sm text-foreground">
          <input id={id} type="checkbox" className="h-4 w-4 rounded border-border accent-forest"
            checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          {field.help_text ?? "Ya"}
        </label>
      ) : (
        <Input
          id={id}
          type={inputType}
          inputMode={field.type === "phone" ? "tel" : undefined}
          aria-invalid={invalid}
          placeholder={field.placeholder ?? ""}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
      {!error && field.help_text && field.type !== "checkbox" ? (
        <p className="mt-1 text-xs text-muted-foreground">{field.help_text}</p>
      ) : null}
    </div>
  );
}
