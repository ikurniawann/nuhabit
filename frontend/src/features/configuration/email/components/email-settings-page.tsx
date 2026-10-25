"use client";

import { useState } from "react";
import { Loader2, Mail, RefreshCw, Save, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  buildEmailPayload,
  draftFrom,
  providerLabel,
  type EmailDraft,
  type EmailLogEntry,
  type EmailProvider,
  type EmailSettings,
  type EmailTransport,
} from "../api";
import {
  useEmailLog,
  useEmailSettings,
  useResendEmail,
  useSaveEmailSettings,
  useSendTestEmail,
} from "../hooks";

/**
 * Settings → Integrasi → Email: provider (Resend atau Microsoft 365 lewat
 * Graph/SMTP), pengirim, kirim email uji ke akun yang login, dan log email
 * keluar dengan kirim ulang. Rahasia hanya ditulis: tampil tersamar, kosong
 * berarti nilai tersimpan dipertahankan.
 */
export function EmailSettingsPage() {
  const settingsQuery = useEmailSettings();
  const settings = settingsQuery.data ?? null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Email</h1>
        <p className="text-sm text-muted-foreground">
          Provider email keluar: slip gaji, kode masuk member, notifikasi gym,
          tautan dataroom dan email rekrutmen. Rahasia disimpan di server dan
          tidak pernah ditampilkan penuh setelah disimpan.
        </p>
      </div>

      {settingsQuery.isError ? (
        <div className="rounded-lg border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-700">
          {settingsQuery.error instanceof Error ? settingsQuery.error.message : "Gagal memuat konfigurasi email"}
        </div>
      ) : null}

      {settingsQuery.isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : null}

      {settings ? (
        <>
          <StatusCard settings={settings} />
          {/* Draf dipasang ulang setelah data tersimpan dimuat ulang. */}
          <SettingsForm key={settingsQuery.dataUpdatedAt} settings={settings} />
          <LogCard />
        </>
      ) : null}
    </div>
  );
}

function StatusCard({ settings }: { settings: EmailSettings }) {
  const test = useSendTestEmail();
  const error = test.error instanceof Error ? test.error.message : null;

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-brand-text">
            <Mail className="size-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">Provider aktif</div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              {settings.configured ? (
                <Badge variant="success">{providerLabel(settings.resolved)}</Badge>
              ) : (
                <Badge variant="warning">Belum dikonfigurasi</Badge>
              )}
              {settings.configured ? <span>Pengirim: {settings.from_email}</span> : null}
            </div>
          </div>
        </div>
        <Button
          type="button"
          onClick={() => test.mutate()}
          disabled={test.isPending || !settings.configured}
          className="gap-2"
        >
          {test.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Kirim email uji
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Email uji dikirim ke alamat akun yang sedang login. Error dari provider ditampilkan apa adanya.
      </p>
      {test.data ? (
        <div className="mt-3 rounded-lg border border-emerald-200/80 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Terkirim ke {test.data.to} lewat {providerLabel(test.data.provider)}. Referensi: {test.data.message_id}
        </div>
      ) : null}
      {error ? (
        <div className="mt-3 rounded-lg border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div className="font-medium">Gagal mengirim email uji</div>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">{error}</pre>
        </div>
      ) : null}
    </section>
  );
}

const PROVIDER_OPTIONS: { value: EmailProvider; label: string }[] = [
  { value: "", label: "Otomatis (Microsoft bila lengkap, lalu Resend)" },
  { value: "resend", label: "Resend" },
  { value: "microsoft", label: "Microsoft 365 / Outlook" },
];

function SettingsForm({ settings }: { settings: EmailSettings }) {
  const [draft, setDraft] = useState<EmailDraft>(() => draftFrom(settings));
  const save = useSaveEmailSettings();
  const set = <K extends keyof EmailDraft>(key: K, value: EmailDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const fromEnv = (key: string) => settings.from_env.includes(key);
  const showResend = draft.provider !== "microsoft";
  const showMicrosoft = draft.provider !== "resend";
  const transport: EmailTransport = draft.transport || "graph";

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Konfigurasi</h2>
          <p className="text-sm text-muted-foreground">
            Field rahasia kosong = biarkan nilai lama. Field bertanda &ldquo;dari env&rdquo; memakai variabel server sampai diisi di sini.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => save.mutate(buildEmailPayload(draft))}
          disabled={save.isPending}
          className="gap-2"
        >
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Simpan
        </Button>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="Provider" envKey="mail_provider" fromEnv={fromEnv}>
          <Select value={draft.provider} onValueChange={(v) => set("provider", v as EmailProvider)}>
            <SelectTrigger aria-label="Provider email">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_OPTIONS.map((o) => (
                <SelectItem key={o.value || "auto"} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="hidden md:block" />
        <Field label="Alamat pengirim (From)" envKey="mail_from_email" fromEnv={fromEnv}>
          <Input
            type="email"
            value={draft.from_email}
            onChange={(e) => set("from_email", e.target.value)}
            placeholder="noreply@nuhabit.id"
          />
        </Field>
        <Field label="Nama pengirim" envKey="mail_from_name" fromEnv={fromEnv}>
          <Input value={draft.from_name} onChange={(e) => set("from_name", e.target.value)} placeholder="NüHabit" />
        </Field>
      </div>

      {showResend ? (
        <fieldset className="mt-6 space-y-4">
          <legend className="text-sm font-semibold text-foreground">Resend</legend>
          <SecretField
            label="API key"
            envKey="mail_resend_api_key"
            fromEnv={fromEnv}
            masked={settings.resend_api_key_masked}
            value={draft.resend_api_key}
            onChange={(v) => set("resend_api_key", v)}
            placeholder="re_…"
          />
          <p className="text-xs text-muted-foreground">
            Pengirim harus di domain yang sudah diverifikasi di Resend.
          </p>
        </fieldset>
      ) : null}

      {showMicrosoft ? (
        <fieldset className="mt-6 space-y-4">
          <legend className="text-sm font-semibold text-foreground">Microsoft 365 / Outlook</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Jalur kirim" envKey="mail_ms_transport" fromEnv={fromEnv}>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["graph", "Graph API (utama)"],
                    ["smtp", "SMTP (cadangan)"],
                  ] as [EmailTransport, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => set("transport", value)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                      transport === value
                        ? "border-primary/30 bg-primary/10 text-brand-text"
                        : "border-border text-muted-foreground hover:bg-muted/40",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          {transport === "graph" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Tenant ID" envKey="mail_ms_tenant_id" fromEnv={fromEnv}>
                <Input
                  value={draft.ms_tenant_id}
                  onChange={(e) => set("ms_tenant_id", e.target.value)}
                  placeholder="contoso.onmicrosoft.com atau GUID"
                />
              </Field>
              <Field label="Application (client) ID" envKey="mail_ms_client_id" fromEnv={fromEnv}>
                <Input value={draft.ms_client_id} onChange={(e) => set("ms_client_id", e.target.value)} />
              </Field>
              <SecretField
                label="Client secret"
                envKey="mail_ms_client_secret"
                fromEnv={fromEnv}
                masked={settings.ms_client_secret_masked}
                value={draft.ms_client_secret}
                onChange={(v) => set("ms_client_secret", v)}
              />
              <Field label="Kirim sebagai (mailbox)" envKey="mail_ms_sender" fromEnv={fromEnv}>
                <Input
                  type="email"
                  value={draft.ms_sender}
                  onChange={(e) => set("ms_sender", e.target.value)}
                  placeholder="Kosong = alamat pengirim"
                />
              </Field>
              <p className="text-xs text-muted-foreground md:col-span-2">
                App registration di Entra dengan izin aplikasi <code>Mail.Send</code> dan admin consent. Hanya untuk
                tenant Microsoft 365; mailbox outlook.com/hotmail.com pribadi memakai SMTP.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Host SMTP" envKey="mail_smtp_host" fromEnv={fromEnv}>
                <Input
                  value={draft.smtp_host}
                  onChange={(e) => set("smtp_host", e.target.value)}
                  placeholder="smtp.office365.com"
                />
              </Field>
              <Field label="Port" envKey="mail_smtp_port" fromEnv={fromEnv}>
                <Input
                  inputMode="numeric"
                  value={draft.smtp_port}
                  onChange={(e) => set("smtp_port", e.target.value)}
                  placeholder="587"
                />
              </Field>
              <Field label="User (alamat mailbox)" envKey="mail_smtp_user" fromEnv={fromEnv}>
                <Input
                  type="email"
                  value={draft.smtp_user}
                  onChange={(e) => set("smtp_user", e.target.value)}
                  placeholder="gym@outlook.com"
                />
              </Field>
              <SecretField
                label="Password / app password"
                envKey="mail_smtp_password"
                fromEnv={fromEnv}
                masked={settings.smtp_password_masked}
                value={draft.smtp_password}
                onChange={(v) => set("smtp_password", v)}
              />
              <p className="text-xs text-muted-foreground md:col-span-2">
                STARTTLS di port 587. Akun dengan MFA butuh app password; Microsoft sedang menghentikan basic auth
                SMTP, jadi pindah ke Graph bila tenant memungkinkan.
              </p>
            </div>
          )}
        </fieldset>
      ) : null}
    </section>
  );
}

function Field({
  label,
  envKey,
  fromEnv,
  children,
}: {
  label: string;
  envKey: string;
  fromEnv: (key: string) => boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {fromEnv(envKey) ? <Badge variant="muted">dari env</Badge> : null}
      </div>
      {children}
    </div>
  );
}

function SecretField({
  label,
  envKey,
  fromEnv,
  masked,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  envKey: string;
  fromEnv: (key: string) => boolean;
  masked: string | null;
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
}) {
  const cleared = value === null;
  return (
    <Field label={label} envKey={envKey} fromEnv={fromEnv}>
      <div className="flex gap-2">
        <Input
          type="password"
          autoComplete="new-password"
          value={value ?? ""}
          disabled={cleared}
          onChange={(e) => onChange(e.target.value)}
          placeholder={cleared ? "Akan dihapus saat disimpan" : masked ?? placeholder ?? ""}
        />
        {masked && !fromEnv(envKey) ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(cleared ? "" : null)}>
            {cleared ? "Batal" : "Hapus"}
          </Button>
        ) : null}
      </div>
    </Field>
  );
}

const STATUS_BADGE: Record<EmailLogEntry["status"], { label: string; variant: "success" | "warning" | "destructive" }> = {
  sent: { label: "Terkirim", variant: "success" },
  queued: { label: "Antrean ulang", variant: "warning" },
  failed: { label: "Gagal", variant: "destructive" },
};

const KIND_LABELS: Record<string, string> = {
  payslip: "Slip gaji",
  otp: "Kode masuk",
  gym: "Notifikasi gym",
  dataroom: "Dataroom",
  recruitment: "Rekrutmen",
  test: "Email uji",
  generic: "Lainnya",
};

function formatTime(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
}

function LogCard() {
  const [status, setStatus] = useState<"" | "sent" | "queued" | "failed">("");
  const [q, setQ] = useState("");
  const logQuery = useEmailLog({ status, q, limit: 100 });
  const resend = useResendEmail();
  const log = logQuery.data;

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Log email keluar</h2>
          <p className="text-sm text-muted-foreground">
            {log
              ? `${log.summary.sent} terkirim · ${log.summary.queued} antrean ulang · ${log.summary.failed} gagal`
              : "Memuat…"}
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari penerima atau subjek"
            className="w-56"
            aria-label="Cari log email"
          />
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="w-40" aria-label="Filter status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Semua status</SelectItem>
              <SelectItem value="sent">Terkirim</SelectItem>
              <SelectItem value="queued">Antrean ulang</SelectItem>
              <SelectItem value="failed">Gagal</SelectItem>
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="icon" onClick={() => logQuery.refetch()} aria-label="Muat ulang">
            <RefreshCw className={cn("size-4", logQuery.isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {logQuery.isError ? (
        <div className="mt-4 rounded-lg border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-700">
          {logQuery.error instanceof Error ? logQuery.error.message : "Gagal memuat log"}
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="py-2 pr-3">Waktu</th>
              <th className="py-2 pr-3">Penerima</th>
              <th className="py-2 pr-3">Subjek</th>
              <th className="py-2 pr-3">Jenis</th>
              <th className="py-2 pr-3">Provider</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Keterangan</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {log?.entries.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-muted-foreground">
                  Belum ada email tercatat.
                </td>
              </tr>
            ) : null}
            {log?.entries.map((e) => {
              const badge = STATUS_BADGE[e.status];
              return (
                <tr key={e.id} className="align-top">
                  <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">{formatTime(e.created_at)}</td>
                  <td className="py-2 pr-3 text-foreground">{e.to}</td>
                  <td className="max-w-[18rem] truncate py-2 pr-3" title={e.subject}>
                    {e.subject}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3">{KIND_LABELS[e.kind] ?? e.kind}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{providerLabel(e.provider)}</td>
                  <td className="whitespace-nowrap py-2 pr-3">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    <span className="ml-1 text-xs text-muted-foreground">
                      {e.attempts}/{e.max_attempts}
                    </span>
                  </td>
                  <td className="max-w-[20rem] py-2 pr-3 text-xs text-muted-foreground">
                    {e.status === "queued" && e.next_attempt_at ? `Coba lagi ${formatTime(e.next_attempt_at)}. ` : null}
                    {e.error ? <span className="break-words text-red-700">{e.error}</span> : null}
                    {e.status === "sent" && e.message_id ? <span className="font-mono">{e.message_id}</span> : null}
                  </td>
                  <td className="py-2 text-right">
                    {e.kind !== "otp" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={resend.isPending}
                        onClick={() => resend.mutate(e.id)}
                      >
                        Kirim ulang
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
