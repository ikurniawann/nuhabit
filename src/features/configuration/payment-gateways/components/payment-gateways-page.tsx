"use client";

import { useEffect, useMemo, useState } from "react";
import { CreditCard, Loader2, Save, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { useUpdatePaymentGateway } from "../mutations";
import { usePaymentGateways } from "../queries";
import type { PaymentGatewayEnvironment, PaymentGatewayPublic } from "../types";
import { StaticQrisCard } from "./static-qris-card";

type Draft = {
  is_active: boolean;
  environment: PaymentGatewayEnvironment;
  secret_key: string;
  public_key: string;
  webhook_secret: string;
  callback_url: string;
};

const emptyDraft = (): Draft => ({
  is_active: false,
  environment: "sandbox",
  secret_key: "",
  public_key: "",
  webhook_secret: "",
  callback_url: "",
});

export function PaymentGatewaysPage() {
  const gatewaysQuery = usePaymentGateways();
  const updateMutation = useUpdatePaymentGateway();
  const [selectedProvider, setSelectedProvider] = useState<"xendit" | "midtrans">("xendit");
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  const gateways = gatewaysQuery.data ?? [];
  const selected = useMemo(
    () => gateways.find((row) => row.provider === selectedProvider) ?? null,
    [gateways, selectedProvider]
  );

  useEffect(() => {
    if (!selected) return;
    setDraft({
      is_active: selected.is_active,
      environment: selected.environment,
      secret_key: selected.secret_key_masked || "",
      public_key: selected.public_key_masked || "",
      webhook_secret: selected.webhook_secret_masked || "",
      callback_url: selected.callback_url || "",
    });
  }, [selected]);

  async function handleSave() {
    if (!selected) return;
    await updateMutation.mutateAsync({
      provider: selected.provider,
      is_active: draft.is_active,
      environment: draft.environment,
      secret_key: draft.secret_key || null,
      public_key: draft.public_key || null,
      webhook_secret: draft.webhook_secret || null,
      callback_url: draft.callback_url || null,
    });
  }

  return (
    <div className="space-y-5">
      <PurchasingPageHeader
        title="Payment Gateways"
        description="Konfigurasi multi payment gateway. Xendit siap dikonfigurasi; Midtrans placeholder untuk tahap berikutnya."
      />

      {gatewaysQuery.isError ? (
        <div className="rounded-lg border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-700">
          {gatewaysQuery.error instanceof Error
            ? gatewaysQuery.error.message
            : "Gagal memuat payment gateways"}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-2 rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Providers
          </div>
          {gatewaysQuery.isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : (
            gateways.map((gateway) => (
              <button
                key={gateway.id}
                type="button"
                onClick={() => setSelectedProvider(gateway.provider)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors",
                  selectedProvider === gateway.provider
                    ? "border-primary/30 bg-primary/5"
                    : "border-border hover:bg-muted/40"
                )}
              >
                <div className="rounded-md bg-primary/10 p-2 text-primary">
                  <CreditCard className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-foreground">{gateway.display_name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {gateway.coming_soon
                      ? "Coming soon"
                      : gateway.is_active
                        ? `Active · ${gateway.environment}`
                        : `Inactive · ${gateway.environment}`}
                  </div>
                </div>
              </button>
            ))
          )}
        </aside>

        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          {!selected ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Pilih provider di sebelah kiri
            </div>
          ) : (
            <GatewayForm
              gateway={selected}
              draft={draft}
              onChange={setDraft}
              onSave={handleSave}
              saving={updateMutation.isPending}
            />
          )}
        </section>
      </div>

      <StaticQrisCard />
    </div>
  );
}

function GatewayForm({
  gateway,
  draft,
  onChange,
  onSave,
  saving,
}: {
  gateway: PaymentGatewayPublic;
  draft: Draft;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const disabled = gateway.coming_soon;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{gateway.display_name}</h2>
          <p className="text-sm text-muted-foreground">
            {gateway.coming_soon
              ? "Provider ini masih placeholder dan belum bisa diaktifkan."
              : "Isi kredensial API. Field secret kosong = biarkan nilai lama."}
          </p>
        </div>
        <Button type="button" onClick={onSave} disabled={saving || disabled} className="gap-2">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saving ? "Saving..." : "Save settings"}
        </Button>
      </div>

      {disabled ? (
        <div className="rounded-lg border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Midtrans coming soon — struktur multi-gateway sudah siap untuk ditambahkan.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-sm font-medium text-foreground">Environment</span>
          <div className="grid grid-cols-2 gap-2">
            {(["sandbox", "live"] as PaymentGatewayEnvironment[]).map((env) => (
              <button
                key={env}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ ...draft, environment: env })}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm font-medium capitalize",
                  draft.environment === env
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground"
                )}
              >
                {env}
              </button>
            ))}
          </div>
        </label>

        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ ...draft, is_active: !draft.is_active })}
          className={cn(
            "flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm",
            draft.is_active
              ? "border-primary/30 bg-primary/5 text-foreground"
              : "border-border bg-muted/30 text-muted-foreground"
          )}
        >
          <span className="font-medium">Aktifkan gateway</span>
          <span
            className={cn(
              "relative h-5 w-9 rounded-full transition-colors",
              draft.is_active ? "bg-primary" : "bg-muted-foreground/30"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform",
                draft.is_active ? "left-4" : "left-0.5"
              )}
            />
          </span>
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <MaskedSecretField
          label="Secret key"
          disabled={disabled}
          value={draft.secret_key}
          maskedHint={gateway.secret_key_masked}
          hasValue={gateway.has_secret_key}
          placeholder="xnd_development_..."
          onChange={(value) => onChange({ ...draft, secret_key: value })}
        />
        <MaskedSecretField
          label="Public key"
          disabled={disabled}
          value={draft.public_key}
          maskedHint={gateway.public_key_masked}
          hasValue={gateway.has_public_key}
          placeholder="Opsional"
          onChange={(value) => onChange({ ...draft, public_key: value })}
        />
        <MaskedSecretField
          label="Webhook secret / token"
          disabled={disabled}
          value={draft.webhook_secret}
          maskedHint={gateway.webhook_secret_masked}
          hasValue={gateway.has_webhook_secret}
          placeholder="XENDIT_WEBHOOK_TOKEN"
          onChange={(value) => onChange({ ...draft, webhook_secret: value })}
        />
        <div className="space-y-1.5">
          <Label>Callback URL</Label>
          <Input
            disabled={disabled}
            value={draft.callback_url}
            onChange={(e) => onChange({ ...draft, callback_url: e.target.value })}
            placeholder="https://your-domain.com/api/payments/xendit/webhook"
            className="border-border font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Samakan dengan Xendit Dashboard → Settings → Callbacks (QR code paid). Endpoint app:{' '}
            <span className="font-mono">/api/payments/xendit/webhook</span>
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Shield className="mt-0.5 size-3.5 shrink-0" />
        Nilai tersimpan ditampilkan sebagian (contoh: xnd_********3456). Fokus ke field lalu ketik
        ulang untuk mengganti. Simpan dengan nilai bertanda ***** = secret lama tetap dipakai.
      </div>
    </div>
  );
}

function MaskedSecretField({
  label,
  value,
  maskedHint,
  hasValue,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  maskedHint: string | null;
  hasValue: boolean;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const isMaskedDisplay = /\*{4,}/.test(value) || value.includes("…") || value.includes("••••");

  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {hasValue ? (
          <span className="ml-1 font-normal text-muted-foreground">(tersimpan)</span>
        ) : null}
      </Label>
      <Input
        type="text"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={value}
        onFocus={() => {
          if (isMaskedDisplay) onChange("");
        }}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hasValue && maskedHint ? maskedHint : placeholder}
        className="border-border font-mono text-sm tracking-wide"
      />
      {hasValue && isMaskedDisplay ? (
        <p className="text-xs text-muted-foreground">Klik field lalu ketik secret baru untuk mengganti.</p>
      ) : null}
    </div>
  );
}
