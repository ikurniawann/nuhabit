"use client";

// EPIC-032 A3 — halaman admin Engine Promosi: daftar campaign + buat
// campaign (kode publik / batch voucher saat simpan). Detail di
// campaign-detail-dialog.

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TicketIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TableRow } from "@/components/ui/table";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { generateBatchCodes, syncVoucherCount } from "../api";
import {
  useCampaigns,
  useCreateCampaign,
  useUpdateCampaign,
} from "../queries";
import {
  PROMO_ELIGIBILITY_LABELS,
  PROMO_SCOPE_LABELS,
  PROMO_SCOPE_PREFIX,
  type PromoCampaign,
  type PromoDiscountType,
  type PromoEligibility,
  type PromoScope,
} from "../types";
import { CampaignDetailDialog } from "./campaign-detail-dialog";
import { CampaignTargetFields, isValidNewMemberDays } from "./campaign-target-fields";
import { GiftCardPage } from "./gift-card-page";

const formatRp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

const formatDiscount = (c: PromoCampaign) =>
  c.discount_type === "percent"
    ? `${Number(c.value)}%${c.max_discount ? ` (maks ${formatRp(Number(c.max_discount))})` : ""}`
    : formatRp(Number(c.value));

const formatWindow = (c: PromoCampaign) => {
  if (!c.valid_from && !c.valid_until) return "Tanpa batas waktu";
  return `${c.valid_from ?? "…"} s/d ${c.valid_until ?? "…"}`;
};

type CodeMode = "none" | "public" | "batch";

interface CampaignForm {
  name: string;
  discount_type: PromoDiscountType;
  value: string;
  max_discount: string;
  min_purchase: string;
  valid_from: string;
  valid_until: string;
  usage_limit: string;
  per_phone_limit: string;
  scope: PromoScope;
  code_mode: CodeMode;
  public_code: string;
  batch_prefix: string;
  batch_count: string;
  target_product_ids: string[];
  target_category_ids: string[];
  eligibility: PromoEligibility;
  new_member_days: string;
}

const EMPTY_FORM: CampaignForm = {
  name: "",
  discount_type: "percent",
  value: "",
  max_discount: "",
  min_purchase: "",
  valid_from: "",
  valid_until: "",
  usage_limit: "",
  per_phone_limit: "1",
  scope: "pos",
  code_mode: "batch",
  public_code: "",
  batch_prefix: "",
  batch_count: "10",
  target_product_ids: [],
  target_category_ids: [],
  eligibility: "semua",
  new_member_days: "",
};

export function PromoPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"campaigns" | "gift-cards">("campaigns");
  const campaignsQuery = useCampaigns();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCodesCount, setEditingCodesCount] = useState(0);
  const [form, setForm] = useState<CampaignForm>(EMPTY_FORM);
  const [detailCampaign, setDetailCampaign] = useState<PromoCampaign | null>(null);
  const [saving, setSaving] = useState(false);
  const pendingBatchRef = useRef<{ prefix: string; count: number } | null>(null);

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setEditingCodesCount(0);
    setForm(EMPTY_FORM);
    setSaving(false);
  };

  const updateMutation = useUpdateCampaign();

  const createMutation = useCreateCampaign(async (result) => {
    const batch = pendingBatchRef.current;
    pendingBatchRef.current = null;
    if (batch) {
      try {
        const generated = await generateBatchCodes(
          result.id,
          batch.prefix,
          batch.count
        );
        toast.success(`${generated.count} voucher berhasil dibuat`);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Campaign dibuat, tapi generate voucher gagal — lanjut dari Kode & Riwayat"
        );
      }
    }
    closeForm();
  });

  const set = (patch: Partial<CampaignForm>) =>
    setForm((current) => ({ ...current, ...patch }));

  const isEdit = editingId !== null;
  const valueNum = Number(form.value);
  const batchCountNum = Number(form.batch_count);
  const resolvedPrefix =
    form.batch_prefix.trim().toUpperCase() || PROMO_SCOPE_PREFIX[form.scope];
  const editBatchInvalid =
    isEdit &&
    (form.batch_count.trim() === "" ||
      Number.isNaN(batchCountNum) ||
      batchCountNum < 0 ||
      batchCountNum > 1000);
  const batchInvalid =
    (!isEdit &&
      form.code_mode === "batch" &&
      (Number.isNaN(batchCountNum) ||
        batchCountNum < 1 ||
        batchCountNum > 1000)) ||
    editBatchInvalid;
  const publicInvalid =
    !isEdit &&
    form.code_mode === "public" &&
    !/^[A-Za-z0-9-]{3,40}$/.test(form.public_code.trim());

  const formInvalid =
    form.name.trim().length < 2 ||
    form.value.trim() === "" ||
    Number.isNaN(valueNum) ||
    valueNum <= 0 ||
    (form.discount_type === "percent" && valueNum > 100) ||
    (form.valid_from !== "" &&
      form.valid_until !== "" &&
      form.valid_until < form.valid_from) ||
    batchInvalid ||
    publicInvalid ||
    !isValidNewMemberDays(form);

  const campaignPayload = () => ({
    name: form.name.trim(),
    discount_type: form.discount_type,
    value: valueNum,
    max_discount:
      form.discount_type === "percent" && form.max_discount.trim() !== ""
        ? Number(form.max_discount)
        : null,
    min_purchase: Number(form.min_purchase) || 0,
    valid_from: form.valid_from || null,
    valid_until: form.valid_until || null,
    usage_limit: form.usage_limit.trim() === "" ? null : Number(form.usage_limit),
    per_phone_limit:
      form.per_phone_limit.trim() === "" ? null : Number(form.per_phone_limit),
    scope: form.scope,
    target_product_ids: form.target_product_ids,
    target_category_ids: form.target_category_ids,
    eligibility: form.eligibility,
    new_member_days:
      form.eligibility === "member_baru" && form.new_member_days.trim() !== ""
        ? Number(form.new_member_days)
        : null,
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (campaign: PromoCampaign) => {
    if (Number(campaign.captured_count) > 0) {
      toast.error("Campaign sudah punya voucher terpakai — tidak bisa diedit");
      return;
    }
    const codesCount = Number(campaign.codes_count) || 0;
    setEditingId(campaign.id);
    setEditingCodesCount(codesCount);
    setForm({
      name: campaign.name,
      discount_type: campaign.discount_type,
      value: String(Number(campaign.value)),
      max_discount: campaign.max_discount
        ? String(Number(campaign.max_discount))
        : "",
      min_purchase:
        Number(campaign.min_purchase) > 0
          ? String(Number(campaign.min_purchase))
          : "",
      valid_from: campaign.valid_from ?? "",
      valid_until: campaign.valid_until ?? "",
      usage_limit:
        campaign.usage_limit !== null ? String(campaign.usage_limit) : "",
      per_phone_limit:
        campaign.per_phone_limit !== null
          ? String(campaign.per_phone_limit)
          : "",
      scope: campaign.scope,
      code_mode: "none",
      public_code: "",
      batch_prefix: "",
      batch_count: String(codesCount),
      target_product_ids: campaign.target_product_ids ?? [],
      target_category_ids: campaign.target_category_ids ?? [],
      eligibility: campaign.eligibility ?? "semua",
      new_member_days:
        campaign.new_member_days !== null ? String(campaign.new_member_days) : "",
    });
    setFormOpen(true);
  };

  const campaigns = campaignsQuery.data ?? [];
  const busy =
    createMutation.isPending || updateMutation.isPending || saving;

  const handleSave = () => {
    if (formInvalid || busy) return;
    if (isEdit && editingId) {
      setSaving(true);
      const campaignId = editingId;
      const targetCount = batchCountNum;
      updateMutation.mutate(
        { id: campaignId, values: campaignPayload() },
        {
          onSuccess: async () => {
            try {
              if (targetCount !== editingCodesCount) {
                const synced = await syncVoucherCount(
                  campaignId,
                  targetCount,
                  resolvedPrefix
                );
                if (synced.added > 0) {
                  toast.success(`${synced.added} voucher ditambah`);
                } else if (synced.removed > 0) {
                  toast.success(`${synced.removed} voucher dihapus`);
                }
                await queryClient.invalidateQueries({ queryKey: ["promo"] });
              }
              closeForm();
            } catch (error) {
              setSaving(false);
              toast.error(
                error instanceof Error
                  ? error.message
                  : "Campaign tersimpan, tapi jumlah voucher gagal diubah"
              );
            }
          },
          onError: () => setSaving(false),
        }
      );
      return;
    }

    setSaving(true);
    pendingBatchRef.current =
      form.code_mode === "batch"
        ? { prefix: resolvedPrefix, count: batchCountNum }
        : null;

    createMutation.mutate(
      {
        ...campaignPayload(),
        ...(form.code_mode === "public" && form.public_code.trim() !== ""
          ? { public_code: form.public_code.trim() }
          : {}),
      },
      {
        onError: () => {
          pendingBatchRef.current = null;
          setSaving(false);
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-foreground">Promo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Buat campaign diskon, keluarkan kode publik atau batch voucher, lalu
          pakai di kasir / tiket.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "campaigns" | "gift-cards")}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="campaigns">Campaign & Voucher</TabsTrigger>
          <TabsTrigger value="gift-cards">Gift Card</TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns" className="mt-4">
          <PurchasingListSection
            icon={TicketIcon}
            title="Campaign Promo"
            description="Satu campaign = satu aturan diskon. Saat simpan bisa langsung generate voucher sesuai jumlah."
            toolbar={
              <Button size="sm" onClick={openCreate}>
                Buat Campaign
              </Button>
            }
          >
            {campaignsQuery.isLoading ? (
              <div className="py-14 text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                <p className="mt-2 text-sm text-muted-foreground">Memuat campaign...</p>
              </div>
            ) : campaigns.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                Belum ada campaign — mulai dari &quot;Buat Campaign&quot;.
              </p>
            ) : (
              <div className="overflow-x-auto px-4 pb-4">
                <table className="w-full text-sm">
                  <thead>
                    <TableRow className="border-b border-gray-200/70 bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground hover:bg-muted/40">
                      <th className="px-4 py-3 text-left font-semibold">Campaign</th>
                      <th className="px-4 py-3 text-left font-semibold">Diskon</th>
                      <th className="px-4 py-3 text-left font-semibold">Kanal</th>
                      <th className="px-4 py-3 text-left font-semibold">Periode</th>
                      <th className="px-4 py-3 text-right font-semibold">Terpakai</th>
                      <th className="px-4 py-3 text-left font-semibold">Aktif</th>
                      <th className="px-4 py-3 text-left font-semibold">Portal member</th>
                      <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                    </TableRow>
                  </thead>
                  <tbody className="divide-y divide-gray-200/50">
                    {campaigns.map((campaign) => (
                      <TableRow key={campaign.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground">{campaign.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {campaign.codes_count} kode
                            {Number(campaign.min_purchase) > 0
                              ? ` · min ${formatRp(Number(campaign.min_purchase))}`
                              : ""}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {campaign.target_product_ids.length +
                              campaign.target_category_ids.length >
                            0 ? (
                              <Badge variant="info">Produk tertentu</Badge>
                            ) : null}
                            {campaign.eligibility !== "semua" ? (
                              <Badge variant="accent">
                                {PROMO_ELIGIBILITY_LABELS[campaign.eligibility]}
                              </Badge>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">
                          {formatDiscount(campaign)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className="border-0 bg-primary/10 font-normal text-primary">
                            {PROMO_SCOPE_LABELS[campaign.scope]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatWindow(campaign)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <p className="font-medium text-foreground">
                            {campaign.captured_count}
                            {campaign.usage_limit !== null
                              ? `/${campaign.usage_limit}`
                              : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {Number(campaign.held_count) > 0
                              ? `${campaign.held_count} menunggu · `
                              : ""}
                            {formatRp(Number(campaign.discount_captured))}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <Switch
                            checked={campaign.is_active}
                            disabled={updateMutation.isPending}
                            onCheckedChange={(checked) =>
                              updateMutation.mutate({
                                id: campaign.id,
                                values: { is_active: checked },
                              })
                            }
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Switch
                            checked={campaign.show_in_member_portal}
                            disabled={updateMutation.isPending}
                            aria-label={`Tampilkan ${campaign.name} di portal member`}
                            onCheckedChange={(checked) =>
                              updateMutation.mutate({
                                id: campaign.id,
                                values: { show_in_member_portal: checked },
                              })
                            }
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            {Number(campaign.captured_count) === 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 px-3"
                                onClick={() => openEdit(campaign)}
                              >
                                Edit
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-3"
                              onClick={() => setDetailCampaign(campaign)}
                            >
                              Kode & Riwayat
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
        </TabsContent>

        <TabsContent value="gift-cards" className="mt-4">
          <GiftCardPage />
        </TabsContent>
      </Tabs>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (busy) return;
          if (!open) closeForm();
          else setFormOpen(true);
        }}
      >
        <DialogPanel size="md" className="sm:max-w-lg">
          <DialogPanelHeader>
            <DialogPanelTitle>
              {isEdit ? "Edit Campaign Promo" : "Buat Campaign Promo"}
            </DialogPanelTitle>
            <DialogPanelDescription>
              {isEdit
                ? "Bisa diedit selama belum ada voucher yang terpakai."
                : "Atur diskon, lalu pilih cara mengeluarkan kode saat simpan."}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="promo_name">Nama Campaign</Label>
              <Input
                id="promo_name"
                placeholder="mis. Promo Kemerdekaan"
                value={form.name}
                disabled={busy}
                onChange={(e) => set({ name: e.target.value })}
                className="border-gray-200/80"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Jenis Diskon</Label>
                <Select
                  value={form.discount_type}
                  disabled={busy}
                  onValueChange={(v) => set({ discount_type: v as PromoDiscountType })}
                >
                  <SelectTrigger className="w-full border-gray-200/80">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Persen (%)</SelectItem>
                    <SelectItem value="fixed">Nominal (Rp)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo_value">
                  {form.discount_type === "percent" ? "Persen" : "Nominal (Rp)"}
                </Label>
                <Input
                  id="promo_value"
                  type="number"
                  min={1}
                  max={form.discount_type === "percent" ? 100 : undefined}
                  value={form.value}
                  disabled={busy}
                  onChange={(e) => set({ value: e.target.value })}
                  className="border-gray-200/80"
                />
              </div>
            </div>

            {form.discount_type === "percent" && (
              <div className="space-y-1.5">
                <Label htmlFor="promo_cap">Maks. Potongan (Rp, opsional)</Label>
                <Input
                  id="promo_cap"
                  type="number"
                  min={1}
                  placeholder="kosong = tanpa batas"
                  value={form.max_discount}
                  disabled={busy}
                  onChange={(e) => set({ max_discount: e.target.value })}
                  className="border-gray-200/80"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="promo_min">Min. Pembelian (Rp)</Label>
                <Input
                  id="promo_min"
                  type="number"
                  min={0}
                  placeholder="0"
                  value={form.min_purchase}
                  disabled={busy}
                  onChange={(e) => set({ min_purchase: e.target.value })}
                  className="border-gray-200/80"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Kanal Berlaku</Label>
                <Select
                  value={form.scope}
                  disabled={busy}
                  onValueChange={(v) => set({ scope: v as PromoScope })}
                >
                  <SelectTrigger className="w-full border-gray-200/80">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(PROMO_SCOPE_LABELS) as [PromoScope, string][]).map(
                      ([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="promo_from">Mulai (opsional)</Label>
                <Input
                  id="promo_from"
                  type="date"
                  value={form.valid_from}
                  disabled={busy}
                  onChange={(e) => set({ valid_from: e.target.value })}
                  className="border-gray-200/80"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo_until">Berakhir (opsional)</Label>
                <Input
                  id="promo_until"
                  type="date"
                  value={form.valid_until}
                  disabled={busy}
                  onChange={(e) => set({ valid_until: e.target.value })}
                  className="border-gray-200/80"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="promo_limit">Kuota Total (opsional)</Label>
                <Input
                  id="promo_limit"
                  type="number"
                  min={1}
                  placeholder="tanpa batas"
                  value={form.usage_limit}
                  disabled={busy}
                  onChange={(e) => set({ usage_limit: e.target.value })}
                  className="border-gray-200/80"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo_phone_limit">Batas per Nomor WA</Label>
                <Input
                  id="promo_phone_limit"
                  type="number"
                  min={1}
                  placeholder="bebas"
                  value={form.per_phone_limit}
                  disabled={busy}
                  onChange={(e) => set({ per_phone_limit: e.target.value })}
                  className="border-gray-200/80"
                />
              </div>
            </div>

            <CampaignTargetFields
              value={form}
              disabled={busy}
              onChange={(patch) => set(patch)}
            />

            {isEdit && (
              <div className="space-y-3 rounded-xl border border-gray-200/70 bg-muted/20 p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit_batch_count">Jumlah Voucher</Label>
                  <Input
                    id="edit_batch_count"
                    type="number"
                    min={0}
                    max={1000}
                    value={form.batch_count}
                    disabled={busy}
                    onChange={(e) =>
                      set({
                        batch_count: e.target.value.replace(/\D/g, "").slice(0, 4),
                      })
                    }
                    className="border-gray-200/80 bg-white"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Saat ini {editingCodesCount} voucher. Naikkan = generate dengan prefix{" "}
                  <span className="font-medium text-foreground">{resolvedPrefix}</span>{" "}
                  (dari kanal {PROMO_SCOPE_LABELS[form.scope]}). Turunkan = hapus yang
                  belum terpakai.
                </p>
              </div>
            )}

            {!isEdit && (
              <div className="space-y-3 rounded-xl border border-gray-200/70 bg-muted/20 p-3">
                <div className="space-y-1.5">
                  <Label>Keluarkan Kode Saat Simpan</Label>
                  <Select
                    value={form.code_mode}
                    disabled={busy}
                    onValueChange={(v) => set({ code_mode: v as CodeMode })}
                  >
                    <SelectTrigger className="w-full border-gray-200/80 bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="batch">Batch voucher (auto-generate)</SelectItem>
                      <SelectItem value="public">Satu kode publik</SelectItem>
                      <SelectItem value="none">Belum — atur nanti</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {form.code_mode === "batch" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="batch_count">Jumlah Voucher</Label>
                    <Input
                      id="batch_count"
                      type="number"
                      min={1}
                      max={1000}
                      value={form.batch_count}
                      disabled={busy}
                      onChange={(e) =>
                        set({
                          batch_count: e.target.value.replace(/\D/g, "").slice(0, 4),
                        })
                      }
                      className="border-gray-200/80 bg-white"
                    />
                    <p className="text-xs text-muted-foreground">
                      Prefix otomatis dari kanal:{" "}
                      <span className="font-medium text-foreground">{resolvedPrefix}</span>
                      {" "}→ contoh {resolvedPrefix}-K7M2X9. Maks 1000 per simpan.
                    </p>
                  </div>
                )}

                {form.code_mode === "public" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="promo_code">Kode Publik</Label>
                    <Input
                      id="promo_code"
                      placeholder="mis. MERDEKA45"
                      value={form.public_code}
                      disabled={busy}
                      onChange={(e) =>
                        set({ public_code: e.target.value.toUpperCase() })
                      }
                      className="border-gray-200/80 bg-white"
                    />
                    <p className="text-xs text-muted-foreground">
                      Satu kode yang bisa dipakai berulang sampai kuota habis.
                    </p>
                  </div>
                )}

                {form.code_mode === "none" && (
                  <p className="text-xs text-muted-foreground">
                    Campaign tersimpan tanpa kode. Generate nanti lewat tombol Kode &
                    Riwayat.
                  </p>
                )}
              </div>
            )}
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={closeForm}>
              Batal
            </Button>
            <Button type="button" disabled={formInvalid || busy} onClick={handleSave}>
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Menyimpan…
                </>
              ) : isEdit ? (
                "Simpan Perubahan"
              ) : form.code_mode === "batch" ? (
                `Buat + Generate ${form.batch_count || "…"} Voucher`
              ) : (
                "Buat Campaign"
              )}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>

      <CampaignDetailDialog
        campaign={detailCampaign}
        onOpenChange={(open) => !open && setDetailCampaign(null)}
      />
    </div>
  );
}
