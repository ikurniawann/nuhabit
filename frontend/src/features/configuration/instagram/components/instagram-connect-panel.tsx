"use client";

import { useState } from "react";
import type { InstagramCredentials } from "../api";
import {
  useDeleteInstagramConfig,
  useInstagramConfig,
  useSaveInstagramConfig,
} from "../queries";
import {
  Camera,
  CheckCircle2,
  Copy,
  Loader2,
  Save,
  ShieldAlert,
  Trash2,
} from "lucide-react";

/**
 * EPIC-013 Fase C — form kredensial Instagram Messaging.
 *
 * Mengikuti pola panel Google Review: rahasia (App Secret & Access Token)
 * tidak pernah dikirim balik dari server; form hanya menampilkan penanda
 * "tersimpan" + samaran. Mengosongkan field rahasia berarti "biarkan yang
 * lama", bukan menghapus.
 */

const WEBHOOK_PATH = "/api/crm/instagram/webhook";

export function InstagramConnectPanel({ onSaved }: { onSaved?: () => void }) {
  const configQuery = useInstagramConfig();
  const saveMutation = useSaveInstagramConfig();
  const deleteMutation = useDeleteInstagramConfig();
  const config = configQuery.data ?? null;
  // Isian user; field yang belum disentuh memakai nilai tersimpan (rahasia selalu kosong).
  const [edits, setEdits] = useState<Partial<InstagramCredentials>>({});
  const form: InstagramCredentials = {
    app_secret: edits.app_secret ?? "",
    access_token: edits.access_token ?? "",
    verify_token: edits.verify_token ?? config?.verify_token ?? "",
    account_id: edits.account_id ?? config?.account_id ?? "",
  };
  const setField = (key: keyof InstagramCredentials) => (value: string) =>
    setEdits((prev) => ({ ...prev, [key]: value }));
  const saving = saveMutation.isPending || deleteMutation.isPending;
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<{
    error: string | null;
    message: string | null;
  }>({
    error: null,
    message: null,
  });
  const loadError =
    configQuery.error instanceof Error ? configQuery.error.message : null;

  async function save() {
    setFeedback({ error: null, message: null });
    try {
      await saveMutation.mutateAsync(form);
      setEdits({});
      setFeedback({ error: null, message: "Kredensial tersimpan." });
      onSaved?.();
    } catch (error) {
      setFeedback({
        error: error instanceof Error ? error.message : "Gagal menyimpan",
        message: null,
      });
    }
  }

  async function hapus() {
    await deleteMutation.mutateAsync();
    setEdits({ verify_token: "", account_id: "" });
    setFeedback({ error: null, message: "Kredensial dihapus." });
    onSaved?.();
  }

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${WEBHOOK_PATH}`
      : WEBHOOK_PATH;

  if (configQuery.isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-violet-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Camera className="size-4 text-pink-600" /> Instagram Messaging
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Diisi Super Admin. App Secret dan Access Token tidak pernah
            ditampilkan kembali.
          </p>
        </div>
        {config?.configured ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="size-3" /> Aktif
          </span>
        ) : config?.webhook_ready ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
            <ShieldAlert className="size-3" /> Terima saja
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            Belum dikonfigurasi
          </span>
        )}
      </div>

      {config?.webhook_ready && !config.configured && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Pesan masuk sudah bisa diterima, tetapi{" "}
          <strong>balasan belum bisa dikirim</strong> — lengkapi Access Token
          dan ID Akun Instagram.
        </p>
      )}

      {/* URL webhook untuk disalin ke dashboard Meta. */}
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          Callback URL (salin ke Meta)
        </label>
        <div className="flex gap-2">
          <input
            readOnly
            value={webhookUrl}
            className="h-9 flex-1 rounded-md border border-slate-300 bg-slate-50 px-2 font-mono text-xs text-slate-700"
          />
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(webhookUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-300 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            <Copy className="size-3.5" /> {copied ? "Tersalin" : "Salin"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Verify Token"
          hint="Anda yang menentukan; salin persis ke Meta."
          value={form.verify_token}
          onChange={setField("verify_token")}
        />
        <Field
          label="ID Akun Instagram"
          hint="Instagram Business Account ID."
          value={form.account_id}
          onChange={setField("account_id")}
        />
        <Field
          label="App Secret"
          type="password"
          hint={
            config?.has_app_secret
              ? `Tersimpan: ${config.app_secret_masked}`
              : "Belum diisi."
          }
          placeholder={
            config?.has_app_secret ? "Biarkan kosong bila tidak diubah" : ""
          }
          value={form.app_secret}
          onChange={setField("app_secret")}
        />
        <Field
          label="Access Token"
          type="password"
          hint={
            config?.has_access_token
              ? `Tersimpan: ${config.access_token_masked}`
              : "Butuh izin instagram_manage_messages."
          }
          placeholder={
            config?.has_access_token ? "Biarkan kosong bila tidak diubah" : ""
          }
          value={form.access_token}
          onChange={setField("access_token")}
        />
      </div>

      {(feedback.error || loadError) && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {feedback.error || loadError}
        </p>
      )}
      {feedback.message && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {feedback.message}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          Simpan
        </button>
        {(config?.has_app_secret || config?.has_access_token) && (
          <button
            type="button"
            onClick={() => void hapus()}
            disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
          >
            <Trash2 className="size-3.5" /> Hapus
          </button>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">
        {label}
      </label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-slate-300 px-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
      />
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}
