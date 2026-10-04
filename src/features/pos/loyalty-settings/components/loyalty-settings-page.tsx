"use client";

import { useMemo, useState } from "react";
import { Coins, Loader2, Save, Sparkles, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DEFAULT_POS_LOYALTY_SETTINGS, normalizeTopupPresets } from "@/lib/pos/loyalty-settings";
import { useUpdateLoyaltySettings } from "../mutations";
import { useLoyaltySettings } from "../queries";
import type { PosLoyaltySettings, TopupXpMode } from "../types";
import { formatNumber } from "@/lib/format";

const formatIdr = (value: number) => formatNumber(value);

function parseAmountInput(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return 0;
  return Number.parseInt(digits, 10) || 0;
}

function formatPresetsText(presets: number[]) {
  return presets.map((value) => formatIdr(value)).join(", ");
}

function parsePresetsText(raw: string) {
  return normalizeTopupPresets(
    raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => parseAmountInput(part))
  );
}

/** Live-format preset list while typing: "50000, 100000" → "50.000, 100.000" */
function formatPresetsInputLive(raw: string) {
  const endsWithComma = /,\s*$/.test(raw);
  const parts = raw.split(",");
  const formatted = parts
    .map((part, index) => {
      const trimmed = part.trim();
      if (!trimmed) return index === parts.length - 1 && endsWithComma ? "" : trimmed;
      const amount = parseAmountInput(trimmed);
      return amount > 0 ? formatIdr(amount) : "";
    })
    .filter((part, index, arr) => part !== "" || index === arr.length - 1);

  const joined = formatted.filter(Boolean).join(", ");
  return endsWithComma ? `${joined}, ` : joined;
}

export function LoyaltySettingsPage() {
  const settingsQuery = useLoyaltySettings();
  const updateMutation = useUpdateLoyaltySettings();
  const [draft, setDraft] = useState<PosLoyaltySettings>(DEFAULT_POS_LOYALTY_SETTINGS);
  const [presetsText, setPresetsText] = useState(
    formatPresetsText(DEFAULT_POS_LOYALTY_SETTINGS.topup_presets)
  );

  // Data server baru (muat awal / setelah simpan) → reset draf saat render.
  const [syncedData, setSyncedData] = useState<PosLoyaltySettings | undefined>(undefined);
  if (settingsQuery.data && settingsQuery.data !== syncedData) {
    setSyncedData(settingsQuery.data);
    setDraft(settingsQuery.data);
    setPresetsText(formatPresetsText(settingsQuery.data.topup_presets));
  }

  const sampleArk = useMemo(() => {
    const rate = Math.max(1, draft.ark_rate || 1000);
    return formatIdr(100000 / rate);
  }, [draft.ark_rate]);

  function patchAmount<K extends keyof PosLoyaltySettings>(key: K, raw: string) {
    setDraft((current) => ({ ...current, [key]: parseAmountInput(raw) as PosLoyaltySettings[K] }));
  }

  function patch<K extends keyof PosLoyaltySettings>(key: K, value: PosLoyaltySettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function handleSave() {
    const presets = parsePresetsText(presetsText);

    await updateMutation.mutateAsync({
      ark_rate: Number(draft.ark_rate),
      topup_min_amount: Number(draft.topup_min_amount),
      topup_presets: presets,
      topup_xp_enabled: draft.topup_xp_enabled,
      topup_xp_mode: draft.topup_xp_mode,
      topup_xp_value: Number(draft.topup_xp_value),
      topup_xp_amount_step: Number(draft.topup_xp_amount_step),
      spend_xp_enabled: draft.spend_xp_enabled,
      spend_xp_amount_step: Number(draft.spend_xp_amount_step),
      spend_xp_min: Math.floor(Number(draft.spend_xp_min)),
    });
  }

  const saving = updateMutation.isPending;
  const loading = settingsQuery.isLoading && !settingsQuery.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">ARK & XP Settings</h1>
          <p className="text-sm text-muted-foreground">
            Master konfigurasi kurs ARK, nominal topup, dan XP dari topup / belanja POS.
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving || loading}
          className="gap-2"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saving ? "Saving..." : "Save settings"}
        </Button>
      </div>

      {settingsQuery.isError && (
        <div className="rounded-lg border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-700">
          {settingsQuery.error instanceof Error
            ? settingsQuery.error.message
            : "Failed to load settings"}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Wallet className="size-5 text-brand-text" />
            <h2 className="text-base font-semibold text-foreground">ARK Topup</h2>
          </div>

          <div className="space-y-4">
            <Field label="Kurs ARK (IDR per 1 ARK)">
              <Input
                type="text"
                inputMode="numeric"
                value={draft.ark_rate ? formatIdr(draft.ark_rate) : ""}
                onChange={(e) => patchAmount("ark_rate", e.target.value)}
                className="border-border focus-visible:ring-primary/30"
              />
              <Hint>Contoh: Rp 100.000 = {sampleArk} ARK</Hint>
            </Field>

            <Field label="Minimum topup (IDR)">
              <Input
                type="text"
                inputMode="numeric"
                value={draft.topup_min_amount ? formatIdr(draft.topup_min_amount) : ""}
                onChange={(e) => patchAmount("topup_min_amount", e.target.value)}
                className="border-border focus-visible:ring-primary/30"
              />
            </Field>

            <Field label="Nominal Topup">
              <Input
                type="text"
                inputMode="numeric"
                value={presetsText}
                onChange={(e) => setPresetsText(formatPresetsInputLive(e.target.value))}
                placeholder="50.000, 100.000, 200.000"
                className="border-border focus-visible:ring-primary/30"
              />
              <Hint>
                Nominal cepat di halaman Topup (pisahkan dengan koma). Aktif:{" "}
                {parsePresetsText(presetsText).map(formatIdr).join(" · ") || "—"}
              </Hint>
            </Field>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="size-5 text-brand-text" />
            <h2 className="text-base font-semibold text-foreground">XP dari Topup</h2>
          </div>

          <div className="space-y-4">
            <Toggle
              checked={draft.topup_xp_enabled}
              onChange={(checked) => patch("topup_xp_enabled", checked)}
              label="Aktifkan XP saat topup ARK"
            />

            <Field label="Mode XP">
              <div className="grid grid-cols-2 gap-2">
                {(["per_amount", "fixed"] as TopupXpMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => patch("topup_xp_mode", mode)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                      draft.topup_xp_mode === mode
                        ? "border-primary/30 bg-primary/10 text-brand-text"
                        : "border-border bg-muted/40 text-muted-foreground hover:bg-muted/70"
                    )}
                  >
                    {mode === "fixed" ? "Fixed" : "Per amount"}
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={draft.topup_xp_mode === "fixed" ? "XP fixed" : "XP per step"}>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.topup_xp_value}
                  onChange={(e) => patch("topup_xp_value", Number(e.target.value) || 0)}
                  className="border-border focus-visible:ring-primary/30"
                />
              </Field>
              <Field label="Amount step (IDR)">
                <Input
                  type="text"
                  inputMode="numeric"
                  value={draft.topup_xp_amount_step ? formatIdr(draft.topup_xp_amount_step) : ""}
                  disabled={draft.topup_xp_mode === "fixed"}
                  onChange={(e) => patchAmount("topup_xp_amount_step", e.target.value)}
                  className="border-border focus-visible:ring-primary/30"
                />
              </Field>
            </div>
            <Hint>
              Default: 1 XP tiap Rp {formatIdr(draft.topup_xp_amount_step || 10000)} topup
            </Hint>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <Coins className="size-5 text-brand-text" />
            <h2 className="text-base font-semibold text-foreground">XP dari Belanja POS</h2>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="md:col-span-3">
              <Toggle
                checked={draft.spend_xp_enabled}
                onChange={(checked) => patch("spend_xp_enabled", checked)}
                label="Aktifkan XP fallback dari total belanja (jika tidak ada CRM XP rule)"
              />
            </div>
            <Field label="Amount step (IDR per 1 XP)">
              <Input
                type="text"
                inputMode="numeric"
                value={draft.spend_xp_amount_step ? formatIdr(draft.spend_xp_amount_step) : ""}
                onChange={(e) => patchAmount("spend_xp_amount_step", e.target.value)}
                className="border-border focus-visible:ring-primary/30"
              />
            </Field>
            <Field label="Minimum XP per order">
              <Input
                type="number"
                min={0}
                value={draft.spend_xp_min}
                onChange={(e) => patch("spend_xp_min", Number(e.target.value) || 0)}
                className="border-border focus-visible:ring-primary/30"
              />
            </Field>
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              Contoh belanja Rp 45.000 →{" "}
              <span className="font-semibold text-foreground">
                {Math.max(
                  draft.spend_xp_min,
                  Math.floor(45000 / Math.max(1, draft.spend_xp_amount_step || 1))
                )}{" "}
                XP
              </span>{" "}
              (tanpa multiplier tier)
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
        checked
          ? "border-primary/30 bg-primary/5 text-foreground"
          : "border-border bg-muted/30 text-muted-foreground"
      )}
    >
      <span className="font-medium">{label}</span>
      <span
        className={cn(
          "relative h-5 w-9 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-muted-foreground/30"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform",
            checked ? "left-4" : "left-0.5"
          )}
        />
      </span>
    </button>
  );
}
