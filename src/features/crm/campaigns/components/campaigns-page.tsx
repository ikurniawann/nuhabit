"use client";

// EPIC-033 — halaman Kampanye WA: daftar kampanye + buat (segmen →
// preview → template → promo) + laporan funnel + konfigurasi pengirim
// (master switch, default MATI) + daftar opt-out. Pengiriman riil
// sepenuhnya di watcher — halaman ini tidak pernah mengirim langsung.

import { useState } from "react";
import { MegaphoneIcon } from "@heroicons/react/24/outline";
import { Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TableRow } from "@/components/ui/table";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { previewSegment } from "../api";
import { useSegments } from "@/features/crm/marketing/queries";
import {
  useAddOptout,
  useCampaignAction,
  useCampaignConfig,
  useCampaignReport,
  useCampaigns,
  useCreateCampaign,
  useOptouts,
  usePromoOptions,
  useRemoveOptout,
  useUpdateCampaignConfig,
} from "../queries";
import type { CampaignChannel, CrmCampaign, SegmentPreview } from "../types";

const formatRp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

const STATUS_BADGES: Record<CrmCampaign["status"], string> = {
  draft: "bg-gray-100 text-gray-600",
  scheduled: "bg-violet-100 text-violet-700",
  sending: "bg-blue-100 text-blue-700",
  paused: "bg-amber-100 text-amber-700",
  done: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-600",
  failed: "bg-red-100 text-red-700",
};
const STATUS_LABELS: Record<CrmCampaign["status"], string> = {
  draft: "Draft",
  scheduled: "Terjadwal",
  sending: "Mengirim",
  paused: "Dijeda",
  done: "Selesai",
  cancelled: "Dibatalkan",
  failed: "Gagal",
};
const CHANNEL_LABELS: Record<CampaignChannel, string> = { wa: "WhatsApp", in_app: "In-app" };

const formatWaktu = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });

/** Nilai awal "Kirim nanti": besok pukul 10.00 waktu lokal. */
function defaultSendAt(): string {
  const d = new Date(Date.now() + 86_400_000);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface CampaignForm {
  name: string;
  message_template: string;
  last_visit_days: string;
  min_xp: string;
  tiers: string;
  /** "" = pakai segmen sederhana di bawah; selain itu id segmen tersimpan. */
  segment_id: string;
  promo_campaign_id: string;
  promo_mode: "public" | "batch";
  voucher_prefix: string;
  daily_cap: string;
  channels: CampaignChannel[];
  inapp_title: string;
  image_url: string;
  link_url: string;
  /** "" = simpan draft; selain itu nilai datetime-local "Kirim nanti". */
  send_at: string;
}

const EMPTY_FORM: CampaignForm = {
  name: "",
  message_template:
    "Halo {nama}! Kami kangen 🎡 Sudah lama tidak berkunjung — pakai kode {kode} untuk potongan spesial di kunjungan berikutnya.",
  last_visit_days: "60",
  min_xp: "",
  tiers: "",
  segment_id: "",
  promo_campaign_id: "",
  promo_mode: "batch",
  voucher_prefix: "WIN",
  daily_cap: "",
  channels: ["wa"],
  inapp_title: "",
  image_url: "",
  link_url: "",
  send_at: "",
};

const NO_PROMO = "tanpa-promo" as const;

export function CampaignsPage() {
  const campaignsQuery = useCampaigns();
  const configQuery = useCampaignConfig();
  const optoutsQuery = useOptouts();
  const promoOptionsQuery = usePromoOptions();
  const actionMutation = useCampaignAction();
  const updateConfig = useUpdateCampaignConfig();
  const [optoutInput, setOptoutInput] = useState("");
  const addOptoutMutation = useAddOptout(() => setOptoutInput(""));
  const removeOptoutMutation = useRemoveOptout();

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CampaignForm>(EMPTY_FORM);
  const [preview, setPreview] = useState<SegmentPreview | null>(null);
  const savedSegments = useSegments().data ?? [];
  const [previewBusy, setPreviewBusy] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [capEdit, setCapEdit] = useState<string | null>(null);

  const createMutation = useCreateCampaign(() => {
    setCreateOpen(false);
    setForm(EMPTY_FORM);
    setPreview(null);
  });

  const set = (patch: Partial<CampaignForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setPreview(null); // segmen berubah → preview basi
  };

  const segmentPayload = () => ({
    last_visit_days:
      form.last_visit_days.trim() === "" ? null : Number(form.last_visit_days),
    tiers: form.tiers
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    min_xp: form.min_xp.trim() === "" ? null : Number(form.min_xp),
  });

  const runPreview = async () => {
    setPreviewBusy(true);
    try {
      setPreview(await previewSegment(segmentPayload(), form.segment_id || null));
    } catch {
      setPreview(null);
    } finally {
      setPreviewBusy(false);
    }
  };

  const withPromo = form.promo_campaign_id !== "";
  const inApp = form.channels.includes("in_app");
  const toggleChannel = (channel: CampaignChannel, on: boolean) =>
    set({
      channels: on
        ? [...new Set([...form.channels, channel])]
        : form.channels.filter((c) => c !== channel),
    });
  const formInvalid =
    form.channels.length === 0 ||
    (form.send_at !== "" && Number.isNaN(new Date(form.send_at).getTime())) ||
    form.name.trim().length < 2 ||
    form.message_template.trim().length < 10 ||
    (withPromo &&
      form.promo_mode === "batch" &&
      !/^[A-Za-z0-9]{2,12}$/.test(form.voucher_prefix.trim())) ||
    (withPromo && !form.message_template.includes("{kode}")) ||
    (!withPromo && form.message_template.includes("{kode}"));

  const handleCreate = () => {
    if (formInvalid || createMutation.isPending) return;
    createMutation.mutate({
      name: form.name.trim(),
      message_template: form.message_template.trim(),
      segment: segmentPayload(),
      segment_id: form.segment_id || null,
      promo_campaign_id: withPromo ? form.promo_campaign_id : null,
      promo_mode: withPromo ? form.promo_mode : null,
      voucher_prefix:
        withPromo && form.promo_mode === "batch"
          ? form.voucher_prefix.trim().toUpperCase()
          : null,
      daily_cap: form.daily_cap.trim() === "" ? null : Number(form.daily_cap),
      channels: form.channels,
      inapp_title: inApp ? form.inapp_title.trim() || null : null,
      image_url: inApp ? form.image_url.trim() || null : null,
      link_url: inApp ? form.link_url.trim() || null : null,
      scheduled_at: form.send_at ? new Date(form.send_at).toISOString() : null,
    });
  };

  const campaigns = campaignsQuery.data ?? [];
  const config = configQuery.data;
  const capValue = capEdit ?? (config ? String(config.daily_cap) : "");
  const reportQuery = useCampaignReport(reportId);

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Kampanye</h1>
        <p className="mt-1 text-sm text-gray-500">
          Win-back & promo tersegmentasi ke member lewat WhatsApp, notifikasi
          in-app, atau keduanya. WA berjalan pelan (anti-ban), menghormati jam
          8–21 WIB, plafon harian, dan opt-out; in-app langsung masuk kotak
          masuk portal.
        </p>
      </div>

      {/* Konfigurasi pengirim */}
      <PurchasingListSection
        icon={MegaphoneIcon}
        title="Pengirim"
        description="Master switch & plafon global. Menyalakan pengiriman = keputusan super admin."
      >
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-gray-200/70 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-gray-900">
                Master Switch Pengiriman
              </p>
              <p className="text-xs text-gray-500">
                {config?.enabled
                  ? "AKTIF — watcher mengirim 1 pesan per ±1 menit dalam jam 8–21 WIB"
                  : "MATI — antrean menunggu; tidak ada pesan keluar (default sampai WA official siap)"}
              </p>
            </div>
            <Switch
              checked={config?.enabled ?? false}
              disabled={updateConfig.isPending || !config}
              onCheckedChange={(checked) =>
                updateConfig.mutate({ enabled: checked })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="daily_cap">Plafon Global per Hari (pesan)</Label>
            <div className="flex gap-2">
              <Input
                id="daily_cap"
                type="number"
                min={1}
                max={2000}
                value={capValue}
                onChange={(e) => setCapEdit(e.target.value.replace(/\D/g, ""))}
              />
              <Button
                size="sm"
                disabled={updateConfig.isPending || capValue.trim() === ""}
                onClick={() =>
                  updateConfig.mutate({ daily_cap: Number(capValue) })
                }
              >
                Simpan
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Lintas semua kampanye venue ini; sisa antrean lanjut besok.
            </p>
          </div>
        </div>
      </PurchasingListSection>

      {/* Daftar kampanye */}
      <PurchasingListSection
        icon={MegaphoneIcon}
        title="Kampanye"
        description="Draft atau terjadwal → Mulai (bangun antrean) → terkirim → laporan. Kampanye terjadwal dimulai otomatis pada waktunya."
        toolbar={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            Buat Kampanye
          </Button>
        }
      >
        {campaignsQuery.isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
          </div>
        ) : campaigns.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-500">
            Belum ada kampanye.
          </p>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                  <th className="px-4 py-3 text-left font-semibold">Kampanye</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Antrean</th>
                  <th className="px-4 py-3 text-right font-semibold">Terkirim</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </TableRow>
              </thead>
              <tbody className="divide-y divide-gray-200/50">
                {campaigns.map((campaign) => (
                  <TableRow key={campaign.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{campaign.name}</p>
                      <p className="text-xs text-gray-500">
                        {campaign.promo_mode === "batch"
                          ? `voucher batch (${campaign.voucher_prefix}-…)`
                          : campaign.promo_campaign_id
                            ? "kode publik"
                            : "tanpa promo"}
                        {campaign.daily_cap
                          ? ` · cap ${campaign.daily_cap}/hari`
                          : ""}
                        {" · "}
                        {(campaign.channels ?? ["wa"]).map((c) => CHANNEL_LABELS[c]).join(" + ")}
                      </p>
                      {campaign.status === "scheduled" && campaign.scheduled_at && (
                        <p className="text-xs text-violet-700">
                          Dikirim {formatWaktu(campaign.scheduled_at)} WIB
                        </p>
                      )}
                      {campaign.status === "failed" && campaign.failure_reason && (
                        <p className="text-xs text-red-600">{campaign.failure_reason}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        className={`border-0 font-normal ${STATUS_BADGES[campaign.status]}`}
                      >
                        {STATUS_LABELS[campaign.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {campaign.pending_count}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {campaign.sent_count}
                      {Number(campaign.failed_count) > 0 ? (
                        <span className="ml-1 text-xs text-red-500">
                          ({campaign.failed_count} gagal)
                        </span>
                      ) : null}
                      {Number(campaign.inapp_count) > 0 && (
                        <span className="block text-xs text-gray-500">
                          {campaign.inapp_count} in-app
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {["draft", "paused", "scheduled", "failed"].includes(campaign.status) && (
                          <Button
                            size="sm"
                            className="h-8 px-3"
                            disabled={actionMutation.isPending}
                            onClick={() =>
                              actionMutation.mutate({
                                id: campaign.id,
                                action:
                                  campaign.status === "paused" || campaign.status === "failed"
                                    ? "resume"
                                    : "start",
                              })
                            }
                          >
                            {campaign.status === "scheduled"
                              ? "Kirim sekarang"
                              : campaign.status === "draft"
                                ? "Mulai"
                                : "Lanjutkan"}
                          </Button>
                        )}
                        {campaign.status === "sending" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-3"
                            disabled={actionMutation.isPending}
                            onClick={() =>
                              actionMutation.mutate({
                                id: campaign.id,
                                action: "pause",
                              })
                            }
                          >
                            Jeda
                          </Button>
                        )}
                        {["draft", "scheduled", "sending", "paused", "failed"].includes(campaign.status) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-3 text-red-600"
                            disabled={actionMutation.isPending}
                            onClick={() => {
                              if (window.confirm(`Batalkan kampanye "${campaign.name}"? Antrean yang belum terkirim tidak akan dikirim.`)) {
                                actionMutation.mutate({ id: campaign.id, action: "cancel" });
                              }
                            }}
                          >
                            Batalkan
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-3"
                          onClick={() => setReportId(campaign.id)}
                        >
                          Laporan
                        </Button>
                      </div>
                    </td>
                  </TableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      {/* Opt-out */}
      <PurchasingListSection
        icon={MegaphoneIcon}
        title="Opt-out Marketing"
        description="Nomor di daftar ini TIDAK pernah masuk antrean kampanye. Terpisah dari consent portal."
      >
        <div className="space-y-3 px-5 py-4">
          <div className="flex gap-2">
            <Input
              placeholder="08xxxxxxxxxx"
              value={optoutInput}
              onChange={(e) => setOptoutInput(e.target.value)}
              className="max-w-xs"
            />
            <Button
              size="sm"
              disabled={
                addOptoutMutation.isPending ||
                optoutInput.replace(/\D/g, "").length < 8
              }
              onClick={() => addOptoutMutation.mutate({ phone: optoutInput })}
            >
              Tambah
            </Button>
          </div>
          {(optoutsQuery.data ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-sm text-gray-500">
              Belum ada nomor opt-out
            </p>
          ) : (
            <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {(optoutsQuery.data ?? []).map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between rounded-lg border border-gray-200/70 px-3 py-2 text-sm"
                >
                  <span className="font-mono text-gray-900">{row.phone}</span>
                  <div className="flex items-center gap-2">
                    <Badge className="border-0 bg-gray-100 font-normal text-gray-600">
                      {row.source}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Hapus opt-out ${row.phone}`}
                      disabled={removeOptoutMutation.isPending}
                      onClick={() => removeOptoutMutation.mutate(row.id)}
                    >
                      <Trash2 className="h-4 w-4 text-gray-400" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PurchasingListSection>

      {/* Dialog buat kampanye */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Buat Kampanye</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nama Kampanye</Label>
              <Input
                placeholder="mis. Win-back Juli"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
              />
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
                  <Label className="text-xs text-gray-500">
                    Tak datang ≥ (hari)
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="60"
                    value={form.last_visit_days}
                    onChange={(e) =>
                      set({ last_visit_days: e.target.value.replace(/\D/g, "") })
                    }
                  />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Min XP</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="kosong = semua"
                    value={form.min_xp}
                    onChange={(e) =>
                      set({ min_xp: e.target.value.replace(/\D/g, "") })
                    }
                  />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">
                    Tier (pisah koma)
                  </Label>
                  <Input
                    placeholder="kosong = semua"
                    value={form.tiers}
                    onChange={(e) => set({ tiers: e.target.value })}
                  />
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={previewBusy}
                  onClick={runPreview}
                >
                  {previewBusy ? "…" : "Preview Penerima"}
                </Button>
                {preview && (
                  <p className="text-sm text-gray-700">
                    <b>{preview.count.toLocaleString("id-ID")}</b> member cocok
                    {preview.optedOut > 0
                      ? ` (+${preview.optedOut} opt-out dilewati)`
                      : ""}
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
                      onChange={(e) => toggleChannel(channel, e.target.checked)}
                    />
                    {channel === "wa" ? "WhatsApp" : "Notifikasi in-app (portal member)"}
                  </label>
                ))}
              </div>
              {form.channels.length === 0 && (
                <p className="mt-1 text-xs text-red-600">Pilih minimal satu kanal.</p>
              )}
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
                    <Input
                      placeholder="https://…"
                      value={form.image_url}
                      onChange={(e) => set({ image_url: e.target.value })}
                    />
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
                    Isi notifikasi memakai template di bawah tanpa footer STOP.
                    Laporan mencatat dibuka dan diklik.
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Template Pesan</Label>
              <Textarea
                rows={4}
                value={form.message_template}
                onChange={(e) => set({ message_template: e.target.value })}
              />
              <p className="text-xs text-gray-500">
                Placeholder: <code>{"{nama}"}</code> = nama member,{" "}
                <code>{"{kode}"}</code> = kode promo. Footer &quot;Balas STOP
                untuk berhenti&quot; otomatis ditambahkan.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Lampirkan Promo (EPIC-032)</Label>
                <Select
                  value={form.promo_campaign_id === "" ? NO_PROMO : form.promo_campaign_id}
                  onValueChange={(v) =>
                    set({ promo_campaign_id: v === NO_PROMO ? "" : v })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PROMO}>Tanpa promo</SelectItem>
                    {(promoOptionsQuery.data ?? [])
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
                  <Select
                    value={form.promo_mode}
                    onValueChange={(v) =>
                      set({ promo_mode: v as "public" | "batch" })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="batch">
                        Voucher unik per penerima
                      </SelectItem>
                      <SelectItem value="public">
                        Kode publik (sama utk semua)
                      </SelectItem>
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
                  onChange={(e) =>
                    set({ voucher_prefix: e.target.value.toUpperCase() })
                  }
                  className="max-w-40"
                />
                <p className="text-xs text-gray-500">
                  Kode per penerima: {form.voucher_prefix || "WIN"}-XXXXXX,
                  sekali pakai.
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
                onChange={(e) =>
                  set({ daily_cap: e.target.value.replace(/\D/g, "") })
                }
                className="max-w-60"
              />
            </div>
            <div className="rounded-xl border border-gray-200/70 p-3">
              <Label>Waktu Kirim</Label>
              <div className="mt-2 flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="send_mode"
                    checked={form.send_at === ""}
                    onChange={() => set({ send_at: "" })}
                  />
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
                    Minimal 5 menit dari sekarang. Antrean dibangun saat waktunya
                    tiba; WA tetap mengikuti master switch dan jam kirim.
                  </p>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Batal
            </Button>
            <Button
              onClick={handleCreate}
              disabled={formInvalid || createMutation.isPending}
            >
              {createMutation.isPending
                ? "Menyimpan…"
                : form.send_at
                  ? "Jadwalkan"
                  : "Simpan Draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog laporan */}
      <Dialog
        open={reportId !== null}
        onOpenChange={(open) => !open && setReportId(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Laporan — {reportQuery.data?.campaign.name ?? "…"}
            </DialogTitle>
          </DialogHeader>
          {reportQuery.isLoading || !reportQuery.data ? (
            <div className="py-8 text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-pink-600" />
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              {reportQuery.data.campaign.failure_reason && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  {reportQuery.data.campaign.failure_reason}
                </p>
              )}
              {reportQuery.data.campaign.channels.includes("in_app") && (
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ["In-app terkirim", reportQuery.data.in_app.sent],
                      ["Dibuka", reportQuery.data.in_app.opened],
                      ["Diklik", reportQuery.data.in_app.clicked],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-gray-200/70 px-3 py-2">
                      <p className="text-xs text-gray-500">{label}</p>
                      <p className="font-semibold tabular-nums text-gray-900">
                        {value.toLocaleString("id-ID")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {(
                [
                  ["Total antrean", reportQuery.data.funnel.total],
                  ["Menunggu kirim", reportQuery.data.funnel.pending],
                  ["WA terkirim", reportQuery.data.funnel.sent],
                  ["WA gagal", reportQuery.data.funnel.failed],
                  ["Voucher dipakai", reportQuery.data.funnel.redeemed],
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="flex justify-between rounded-lg border border-gray-200/70 px-3 py-2"
                >
                  <span className="text-gray-600">{label}</span>
                  <span className="font-semibold tabular-nums text-gray-900">
                    {value.toLocaleString("id-ID")}
                  </span>
                </div>
              ))}
              {reportQuery.data.funnel.redeemed_value > 0 && (
                <p className="text-xs text-gray-500">
                  Nilai potongan terpakai:{" "}
                  {formatRp(reportQuery.data.funnel.redeemed_value)}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
