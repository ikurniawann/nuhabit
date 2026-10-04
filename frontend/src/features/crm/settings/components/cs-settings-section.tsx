"use client";

import { useState } from "react";
import { Clock, Headset, Loader2, MessageSquareReply, Save, Star, Timer } from "lucide-react";
import type { CrmSettings } from "../types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Draft = {
  cs_sla_response_minutes: string;
  cs_sla_resolution_minutes: string;
  cs_business_hours_start: string;
  cs_business_hours_end: string;
  cs_auto_reply_enabled: boolean;
  cs_auto_reply_text: string;
  cs_csat_enabled: boolean;
  cs_csat_text: string;
};

function toDraft(settings: CrmSettings | undefined): Draft {
  return {
    cs_sla_response_minutes: String(settings?.cs_sla_response_minutes ?? 15),
    cs_sla_resolution_minutes: String(settings?.cs_sla_resolution_minutes ?? 1440),
    cs_business_hours_start: String(settings?.cs_business_hours_start ?? 10),
    cs_business_hours_end: String(settings?.cs_business_hours_end ?? 22),
    cs_auto_reply_enabled: settings?.cs_auto_reply_enabled ?? true,
    cs_auto_reply_text: settings?.cs_auto_reply_text ?? "",
    cs_csat_enabled: settings?.cs_csat_enabled ?? true,
    cs_csat_text: settings?.cs_csat_text ?? "",
  };
}

const jam = (value: string) => `${String(value).padStart(2, "0")}.00`;

const inputClass =
  "h-10 border-gray-200/80 bg-white focus-visible:border-primary/40 focus-visible:ring-1 focus-visible:ring-primary/30";

export function CsSettingsSection({
  settings,
  loading,
  saving,
  onSave,
}: {
  settings: CrmSettings | undefined;
  loading: boolean;
  saving: boolean;
  onSave: (payload: Partial<CrmSettings>) => void;
}) {
  // Pemanggil me-mount ulang lewat `key` saat pengaturan server berubah.
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));

  const start = Number(draft.cs_business_hours_start);
  const end = Number(draft.cs_business_hours_end);
  const buka24Jam = start === end;
  const lewatTengahMalam = start > end;

  function submit() {
    if (saving || loading) return;
    onSave({
      cs_sla_response_minutes: Math.max(1, Number(draft.cs_sla_response_minutes) || 15),
      cs_sla_resolution_minutes: Math.max(1, Number(draft.cs_sla_resolution_minutes) || 1440),
      cs_business_hours_start: Math.min(23, Math.max(0, Number(draft.cs_business_hours_start) || 0)),
      cs_business_hours_end: Math.min(23, Math.max(0, Number(draft.cs_business_hours_end) || 0)),
      cs_auto_reply_enabled: draft.cs_auto_reply_enabled,
      cs_auto_reply_text: draft.cs_auto_reply_text.trim() || undefined,
      cs_csat_enabled: draft.cs_csat_enabled,
      cs_csat_text: draft.cs_csat_text.trim() || undefined,
    });
  }

  const disabled = loading || saving;

  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Headset className="h-4 w-4 text-brand-text" />
          Customer Service (WhatsApp)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            icon={Timer}
            label="Batas balas pertama (menit)"
            hint="Percakapan yang belum dibalas melewati ini ditandai “Lewat SLA” di inbox."
          >
            <Input
              type="number"
              min={1}
              max={1440}
              value={draft.cs_sla_response_minutes}
              onChange={(event) =>
                setDraft((current) => ({ ...current, cs_sla_response_minutes: event.target.value }))
              }
              disabled={disabled}
              className={inputClass}
            />
          </Field>

          <Field
            icon={Timer}
            label="Target penyelesaian (menit)"
            hint="Dipakai sebagai acuan di laporan. 1440 = 1 hari."
          >
            <Input
              type="number"
              min={1}
              max={10080}
              value={draft.cs_sla_resolution_minutes}
              onChange={(event) =>
                setDraft((current) => ({ ...current, cs_sla_resolution_minutes: event.target.value }))
              }
              disabled={disabled}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="rounded-lg border border-gray-200/70 bg-muted/40 p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Jam operasional chat
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="cs-start" className="text-xs text-muted-foreground">
                Mulai
              </Label>
              <select
                id="cs-start"
                value={draft.cs_business_hours_start}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, cs_business_hours_start: event.target.value }))
                }
                disabled={disabled}
                className={`w-full rounded-lg px-3 text-sm ${inputClass}`}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>
                    {jam(String(hour))}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cs-end" className="text-xs text-muted-foreground">
                Selesai
              </Label>
              <select
                id="cs-end"
                value={draft.cs_business_hours_end}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, cs_business_hours_end: event.target.value }))
                }
                disabled={disabled}
                className={`w-full rounded-lg px-3 text-sm ${inputClass}`}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>
                    {jam(String(hour))}
                  </option>
                ))}
              </select>
            </div>
            <p className="pb-2 text-xs text-muted-foreground">
              {buka24Jam
                ? "Buka 24 jam — auto-reply tidak pernah aktif."
                : lewatTengahMalam
                  ? `Melewati tengah malam: ${jam(draft.cs_business_hours_start)}–${jam(draft.cs_business_hours_end)} WIB`
                  : `${jam(draft.cs_business_hours_start)}–${jam(draft.cs_business_hours_end)} WIB`}
            </p>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Waktu mengikuti zona WIB. Jam selesai bersifat eksklusif — 22.00 berarti pesan pukul 22.00
            sudah dianggap di luar jam operasional.
          </p>
        </div>

        <div className="space-y-3 rounded-lg border border-gray-200/70 bg-muted/40 p-3">
          <div className="flex items-center justify-between gap-3">
            <Label className="flex items-center gap-2 text-sm text-foreground">
              <MessageSquareReply className="h-4 w-4 text-muted-foreground" />
              Balas otomatis di luar jam operasional
            </Label>
            <Switch
              checked={draft.cs_auto_reply_enabled}
              onCheckedChange={(checked) =>
                setDraft((current) => ({ ...current, cs_auto_reply_enabled: checked }))
              }
              disabled={disabled}
            />
          </div>
          <textarea
            rows={3}
            value={draft.cs_auto_reply_text}
            onChange={(event) =>
              setDraft((current) => ({ ...current, cs_auto_reply_text: event.target.value }))
            }
            disabled={disabled || !draft.cs_auto_reply_enabled}
            className={`w-full resize-y rounded-lg px-3 py-2 text-sm ${inputClass} h-auto min-h-[84px]`}
          />
          <p className="text-xs text-muted-foreground">
            Dikirim maksimal sekali per hari untuk tiap percakapan, agar tidak membanjiri customer.
          </p>
        </div>

        <div className="space-y-3 rounded-lg border border-gray-200/70 bg-muted/40 p-3">
          <div className="flex items-center justify-between gap-3">
            <Label className="flex items-center gap-2 text-sm text-foreground">
              <Star className="h-4 w-4 text-muted-foreground" />
              Minta penilaian saat percakapan ditandai selesai
            </Label>
            <Switch
              checked={draft.cs_csat_enabled}
              onCheckedChange={(checked) =>
                setDraft((current) => ({ ...current, cs_csat_enabled: checked }))
              }
              disabled={disabled}
            />
          </div>
          <textarea
            rows={2}
            value={draft.cs_csat_text}
            onChange={(event) =>
              setDraft((current) => ({ ...current, cs_csat_text: event.target.value }))
            }
            disabled={disabled || !draft.cs_csat_enabled}
            className={`w-full resize-y rounded-lg px-3 py-2 text-sm ${inputClass} h-auto min-h-[72px]`}
          />
          <p className="text-xs text-muted-foreground">
            Customer membalas angka 1–5; skornya masuk ke laporan CS.
          </p>
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={submit}
            disabled={disabled}
            className="purchasing-main-button"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Menyimpan..." : "Simpan konfigurasi CS"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  icon: Icon,
  label,
  hint,
  children,
}: {
  icon: typeof Timer;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </Label>
      {children}
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
