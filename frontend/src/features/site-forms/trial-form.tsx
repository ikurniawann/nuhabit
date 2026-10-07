"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { HONEYPOT_FIELD, readPageAttribution } from "@/lib/crm/public-forms";
import { CONSENT_EMAIL_TEXT, CONSENT_SMS_TEXT, CONSENT_TEXT_VERSION } from "./consent";
import { fetchPublicBranches, type PublicBranch } from "./branches";
import { COUNTRY_CODES } from "./phone";
import { pushDataLayer } from "./track";
import { EMPTY_TRIAL, type TrialField, type TrialValues, trialPayload, validateTrial } from "./trial-validation";

export type TrialBranch = PublicBranch;

const selectClass =
  "h-11 w-full rounded-2xl border border-border bg-card px-4 text-sm text-foreground outline-none focus-visible:border-forest focus-visible:ring-2 focus-visible:ring-forest/20 aria-invalid:border-destructive";

/**
 * Form coba gratis: cabang, nama, email, nomor telepon dengan kode negara,
 * dua persetujuan pemasaran. Tombol kirim aktif hanya saat isian valid.
 * `branches` boleh diberikan oleh halaman; tanpa itu diambil dari
 * /api/public/site/branches.
 */
export function TrialForm({ branches: given, defaultBranch, sourcePath }: {
  branches?: TrialBranch[];
  defaultBranch?: string;
  sourcePath?: string;
}) {
  const [branches, setBranches] = useState<TrialBranch[]>(given ?? []);
  const [values, setValues] = useState<TrialValues>({ ...EMPTY_TRIAL, branch_slug: defaultBranch ?? "" });
  const [touched, setTouched] = useState<Partial<Record<TrialField, boolean>>>({});
  const [honeypot, setHoneypot] = useState("");
  const [startedAt] = useState(() => Date.now());
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [banner, setBanner] = useState<string | null>(null);
  const [sentBranch, setSentBranch] = useState<string>("");

  useEffect(() => {
    pushDataLayer("trial_open", { branch: defaultBranch ?? null });
  }, [defaultBranch]);

  useEffect(() => {
    if (given) return;
    let active = true;
    fetchPublicBranches().then((list) => {
      if (active) setBranches(list);
    });
    return () => {
      active = false;
    };
  }, [given]);

  const errors = validateTrial(values);
  const valid = Object.keys(errors).length === 0;
  const set = <K extends TrialField>(key: K, value: TrialValues[K]) => setValues((prev) => ({ ...prev, [key]: value }));
  const touch = (key: TrialField) => setTouched((prev) => ({ ...prev, [key]: true }));
  const shown = (key: TrialField) => (touched[key] ? errors[key] : undefined);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || status === "sending") return;
    setStatus("sending");
    setBanner(null);
    const path = sourcePath ?? (typeof window === "undefined" ? "" : window.location.pathname);
    try {
      const res = await fetch("/api/public/site/trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...trialPayload(values, { utm: readPageAttribution(), source_path: path, form_started_at: startedAt }),
          [HONEYPOT_FIELD]: honeypot,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        data?: { lead_id: string | null; branch_name: string | null };
      };
      if (!res.ok || !body.success) {
        setBanner(body.error ?? "Gagal mengirim. Coba lagi sebentar lagi.");
        setStatus("idle");
        return;
      }
      const branchName = body.data?.branch_name ?? branches.find((b) => b.slug === values.branch_slug)?.name ?? "";
      setSentBranch(branchName);
      setStatus("sent");
      pushDataLayer("lead_submit", { form: "trial", branch: values.branch_slug, lead_id: body.data?.lead_id ?? null });
    } catch {
      setBanner("Jaringan bermasalah. Coba lagi sebentar lagi.");
      setStatus("idle");
    }
  };

  if (status === "sent") {
    return (
      <div className="py-8 text-center" role="status">
        <CheckCircle2 className="mx-auto h-14 w-14 text-forest" />
        <p className="mt-4 text-2xl font-bold text-foreground">Permintaan diterima</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Terima kasih, {values.first_name.trim()}. Tim {sentBranch || "NüHabit"} akan menghubungi Anda lewat WhatsApp untuk mengatur sesi pertama.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {banner ? (
        <p className="rounded-2xl bg-danger-soft px-4 py-2.5 text-sm text-danger" role="alert">{banner}</p>
      ) : null}

      <div>
        <Label htmlFor="trial-branch" className="mb-1.5">Cabang</Label>
        <select
          id="trial-branch"
          className={selectClass}
          aria-invalid={Boolean(shown("branch_slug"))}
          value={values.branch_slug}
          onBlur={() => touch("branch_slug")}
          onChange={(e) => {
            set("branch_slug", e.target.value);
            touch("branch_slug");
            if (e.target.value) pushDataLayer("studio_select", { branch: e.target.value });
          }}
        >
          <option value="">Pilih cabang</option>
          {branches.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
        </select>
        <FieldError message={shown("branch_slug")} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="trial-first-name" className="mb-1.5">Nama depan</Label>
          <Input id="trial-first-name" autoComplete="given-name" value={values.first_name} aria-invalid={Boolean(shown("first_name"))}
            onBlur={() => touch("first_name")} onChange={(e) => set("first_name", e.target.value)} />
          <FieldError message={shown("first_name")} />
        </div>
        <div>
          <Label htmlFor="trial-last-name" className="mb-1.5">Nama belakang</Label>
          <Input id="trial-last-name" autoComplete="family-name" value={values.last_name} aria-invalid={Boolean(shown("last_name"))}
            onBlur={() => touch("last_name")} onChange={(e) => set("last_name", e.target.value)} />
          <FieldError message={shown("last_name")} />
        </div>
      </div>

      <div>
        <Label htmlFor="trial-email" className="mb-1.5">Email</Label>
        <Input id="trial-email" type="email" autoComplete="email" inputMode="email" value={values.email} aria-invalid={Boolean(shown("email"))}
          onBlur={() => touch("email")} onChange={(e) => set("email", e.target.value)} />
        <FieldError message={shown("email")} />
      </div>

      <div>
        <Label htmlFor="trial-phone" className="mb-1.5">Nomor WhatsApp</Label>
        <div className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] gap-2">
          <select
            aria-label="Kode negara"
            className={selectClass}
            value={values.phone_country}
            onChange={(e) => set("phone_country", e.target.value)}
          >
            {COUNTRY_CODES.map((c) => <option key={c.code} value={c.code}>{c.code} {c.dial}</option>)}
          </select>
          <Input id="trial-phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="812 3456 7890"
            value={values.phone_local} aria-invalid={Boolean(shown("phone_local"))}
            onBlur={() => touch("phone_local")} onChange={(e) => set("phone_local", e.target.value)} />
        </div>
        <FieldError message={shown("phone_local")} />
      </div>

      <ConsentToggle id="trial-consent-email" checked={values.consent_email} onChange={(v) => set("consent_email", v)} text={CONSENT_EMAIL_TEXT} />
      <ConsentToggle id="trial-consent-sms" checked={values.consent_sms} onChange={(v) => set("consent_sms", v)} text={CONSENT_SMS_TEXT} />

      {/* Jebakan bot: tersembunyi dari manusia, terisi oleh pengisi otomatis. */}
      <div className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor={`trial-${HONEYPOT_FIELD}`}>Jangan diisi</label>
        <input id={`trial-${HONEYPOT_FIELD}`} name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off"
          value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
      </div>

      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={!valid || status === "sending"}>
        {status === "sending" ? <Loader2 className="animate-spin" /> : null}
        Ajukan coba gratis
      </Button>
      <p className="text-xs text-muted-foreground">
        Tim cabang menghubungi lewat WhatsApp untuk mengatur jadwal. Versi persetujuan {CONSENT_TEXT_VERSION}.
      </p>
    </form>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs text-danger">{message}</p> : null;
}

function ConsentToggle({ id, checked, onChange, text }: { id: string; checked: boolean; onChange: (v: boolean) => void; text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-surface-2 p-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={`${id}-text`} className="mt-0.5" />
      <label id={`${id}-text`} htmlFor={id} className="text-sm leading-snug text-body">{text}</label>
    </div>
  );
}
