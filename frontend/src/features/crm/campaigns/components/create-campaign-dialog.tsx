"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatNumber } from "@/lib/format";
import { useSegments } from "@/features/crm/marketing/queries";
import { previewSegment } from "../api";
import { useCreateCampaign, usePromoOptions } from "../queries";
import type { SegmentPreview } from "../types";
import {
  EMPTY_CAMPAIGN_FORM,
  defaultSendAt,
  isCampaignFormInvalid,
  segmentFromForm,
  toCreateCampaignInput,
  withChannel,
  type CampaignForm,
} from "../campaign-form";

const NO_PROMO = "tanpa-promo" as const;
const digits = (value: string) => value.replace(/\D/g, "");

/**
 * Dialog buat kampanye: segmen → preview → kanal → template → promo → jadwal.
 * Draf form bertahan saat dialog ditutup dan baru dikosongkan setelah berhasil disimpan.
 */
export function CreateCampaignDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [form, setForm] = useState<CampaignForm>(EMPTY_CAMPAIGN_FORM);
  const [preview, setPreview] = useState<SegmentPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const savedSegments = useSegments().data ?? [];
  const promoOptions = usePromoOptions().data ?? [];
  const createMutation = useCreateCampaign(() => {
    onOpenChange(false);
    setForm(EMPTY_CAMPAIGN_FORM);
    setPreview(null);
  });

  const set = (patch: Partial<CampaignForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setPreview(null); // segmen berubah → preview basi
  };

  async function runPreview() {
    setPreviewBusy(true);
    try {
      setPreview(await previewSegment(segmentFromForm(form), form.segment_id || null));
    } catch {
      setPreview(null);
    } finally {
      setPreviewBusy(false);
    }
  }

  const withPromo = form.promo_campaign_id !== "";
  const inApp = form.channels.includes("in_app");
  const formInvalid = isCampaignFormInvalid(form);

  function handleCreate() {
    if (formInvalid || createMutation.isPending) return;
    createMutation.mutate(toCreateCampaignInput(form));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Buat Kampanye</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nama Kampanye</Label>
            <Input placeholder="mis. Win-back Juli" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </div>

          <div className="rounded-xl border border-gray-200/70 p-3">
            <Label>Segmen Penerima</Label>
            <div className="mt-2">
              <Label className="text-xs text-gray-500">Segmen tersimpan (Marketing → Segmen)</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm"
                value={form.segment_id}
                onChange={(e) => set({ segment_id: e.target.value })}
              >
                <option value="">Pakai segmen sederhana di bawah</option>
                {savedSegments
                  .filter((sg) => sg.is_active && sg.source === "member")
                  .map((sg) => (
                    <option key={sg.id} value={sg.id}>
                      {sg.name}
                      {sg.last_count !== null ? ` (${sg.last_count} anggota)` : ""}
                    </option>
                  ))}
              </select>
            </div>
            <div className={`mt-2 grid grid-cols-3 gap-2 ${form.segment_id ? "pointer-events-none opacity-40" : ""}`}>
              <div>
                <Label className="text-xs text-gray-500">Tak datang ≥ (hari)</Label>
                <Input
                  type="number"
                  min={1}
                  placeholder="60"
                  value={form.last_visit_days}
                  onChange={(e) => set({ last_visit_days: digits(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs text-gray-500">Min XP</Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="kosong = semua"
                  value={form.min_xp}
                  onChange={(e) => set({ min_xp: digits(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs text-gray-500">Tier (pisah koma)</Label>
                <Input placeholder="kosong = semua" value={form.tiers} onChange={(e) => set({ tiers: e.target.value })} />
              </div>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <Button size="sm" variant="outline" disabled={previewBusy} onClick={() => void runPreview()}>
                {previewBusy ? "…" : "Preview Penerima"}
              </Button>
              {preview && (
                <p className="text-sm text-gray-700">
                  <b>{formatNumber(preview.count)}</b> member cocok
                  {preview.optedOut > 0 ? ` (+${preview.optedOut} opt-out dilewati)` : ""}
                </p>
              )}
            </div>
            {preview && preview.sample.length > 0 && (
              <p className="mt-1 truncate text-xs text-gray-400">
                Sampel: {preview.sample.map((s) => s.name).join(", ")}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-gray-200/70 p-3">
            <Label>Kanal</Label>
            <div className="mt-2 flex flex-wrap gap-4">
              {(["wa", "in_app"] as const).map((channel) => (
                <label key={channel} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={form.channels.includes(channel)}
                    onChange={(e) => set({ channels: withChannel(form.channels, channel, e.target.checked) })}
                  />
                  {channel === "wa" ? "WhatsApp" : "Notifikasi in-app (portal member)"}
                </label>
              ))}
            </div>
            {form.channels.length === 0 && <p className="mt-1 text-xs text-red-600">Pilih minimal satu kanal.</p>}
            {inApp && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label className="text-xs text-gray-500">Judul notifikasi</Label>
                  <Input
                    placeholder={form.name || "Kosong = nama kampanye"}
                    value={form.inapp_title}
                    maxLength={120}
                    onChange={(e) => set({ inapp_title: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">URL gambar (opsional)</Label>
                  <Input placeholder="https://…" value={form.image_url} onChange={(e) => set({ image_url: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Tautan saat diketuk (opsional)</Label>
                  <Input
                    placeholder="/member/promos atau https://…"
                    value={form.link_url}
                    onChange={(e) => set({ link_url: e.target.value })}
                  />
                </div>
                <p className="text-xs text-gray-500 sm:col-span-2">
                  Isi notifikasi memakai template di bawah tanpa footer STOP. Laporan mencatat dibuka dan diklik.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Template Pesan</Label>
            <Textarea rows={4} value={form.message_template} onChange={(e) => set({ message_template: e.target.value })} />
            <p className="text-xs text-gray-500">
              Placeholder: <code>{"{nama}"}</code> = nama member, <code>{"{kode}"}</code> = kode promo. Footer &quot;Balas
              STOP untuk berhenti&quot; otomatis ditambahkan.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Lampirkan Promo (EPIC-032)</Label>
              <Select
                value={form.promo_campaign_id === "" ? NO_PROMO : form.promo_campaign_id}
                onValueChange={(v) => set({ promo_campaign_id: v === NO_PROMO ? "" : v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROMO}>Tanpa promo</SelectItem>
                  {promoOptions
                    .filter((p) => p.is_active)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {withPromo && (
              <div className="space-y-1.5">
                <Label>Mode Kode</Label>
                <Select value={form.promo_mode} onValueChange={(v) => set({ promo_mode: v as "public" | "batch" })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="batch">Voucher unik per penerima</SelectItem>
                    <SelectItem value="public">Kode publik (sama utk semua)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {withPromo && form.promo_mode === "batch" && (
            <div className="space-y-1.5">
              <Label>Prefix Voucher</Label>
              <Input
                placeholder="mis. WIN"
                value={form.voucher_prefix}
                onChange={(e) => set({ voucher_prefix: e.target.value.toUpperCase() })}
                className="max-w-40"
              />
              <p className="text-xs text-gray-500">
                Kode per penerima: {form.voucher_prefix || "WIN"}-XXXXXX, sekali pakai.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Plafon Kampanye per Hari (opsional)</Label>
            <Input
              type="number"
              min={1}
              placeholder="kosong = ikut plafon global"
              value={form.daily_cap}
              onChange={(e) => set({ daily_cap: digits(e.target.value) })}
              className="max-w-60"
            />
          </div>
          <div className="rounded-xl border border-gray-200/70 p-3">
            <Label>Waktu Kirim</Label>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="send_mode" checked={form.send_at === ""} onChange={() => set({ send_at: "" })} />
                Simpan draft, mulai manual
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="send_mode"
                  checked={form.send_at !== ""}
                  onChange={() => set({ send_at: defaultSendAt() })}
                />
                Kirim nanti
              </label>
            </div>
            {form.send_at !== "" && (
              <div className="mt-2 space-y-1">
                <Input
                  type="datetime-local"
                  value={form.send_at}
                  onChange={(e) => set({ send_at: e.target.value })}
                  className="max-w-64"
                />
                <p className="text-xs text-gray-500">
                  Minimal 5 menit dari sekarang. Antrean dibangun saat waktunya tiba; WA tetap mengikuti master switch
                  dan jam kirim.
                </p>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button onClick={handleCreate} disabled={formInvalid || createMutation.isPending}>
            {createMutation.isPending ? "Menyimpan…" : form.send_at ? "Jadwalkan" : "Simpan Draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
