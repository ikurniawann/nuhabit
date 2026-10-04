"use client";

// Dialog buat/ubah campaign promo. Buat: kode publik atau batch voucher saat
// simpan. Ubah: jumlah voucher disamakan (tambah/hapus yang belum terpakai).

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { generateBatchCodes, syncVoucherCount } from "../api";
import {
  EMPTY_CAMPAIGN_FORM,
  campaignFormFromCampaign,
  campaignPayload,
  isCampaignFormInvalid,
  resolveVoucherPrefix,
  type CampaignForm,
  type CodeMode,
} from "../campaign-form";
import { useCreateCampaign, useUpdateCampaign } from "../queries";
import { PROMO_SCOPE_LABELS, type PromoCampaign, type PromoDiscountType, type PromoScope } from "../types";
import { CampaignTargetFields } from "./campaign-target-fields";

const digits4 = (raw: string) => raw.replace(/\D/g, "").slice(0, 4);

/** Dipasang dengan `key` per campaign: state form diisi dari props saat mount. */
export function CampaignFormDialog({ campaign, onClose }: {
  /** null = campaign baru. */
  campaign: PromoCampaign | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = campaign !== null;
  const codesCount = Number(campaign?.codes_count) || 0;
  const [form, setForm] = useState<CampaignForm>(() => (campaign ? campaignFormFromCampaign(campaign) : EMPTY_CAMPAIGN_FORM));
  const [saving, setSaving] = useState(false);
  const createMutation = useCreateCampaign();
  const updateMutation = useUpdateCampaign();

  const set = (patch: Partial<CampaignForm>) => setForm((current) => ({ ...current, ...patch }));
  const busy = saving || createMutation.isPending || updateMutation.isPending;
  const formInvalid = isCampaignFormInvalid(form, isEdit);
  const prefix = resolveVoucherPrefix(form);
  const batchCount = Number(form.batch_count);

  const refreshPromo = () => queryClient.invalidateQueries({ queryKey: ["promo"] });

  /** Ubah campaign lalu samakan jumlah voucher; galat sinkron menahan dialog tetap terbuka. */
  async function saveEdit(id: string) {
    await updateMutation.mutateAsync({ id, values: campaignPayload(form) });
    if (batchCount === codesCount) return true;
    try {
      const synced = await syncVoucherCount(id, batchCount, prefix);
      if (synced.added > 0) toast.success(`${synced.added} voucher ditambah`);
      else if (synced.removed > 0) toast.success(`${synced.removed} voucher dihapus`);
      await refreshPromo();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Campaign tersimpan, tapi jumlah voucher gagal diubah");
      return false;
    }
  }

  /** Buat campaign (+ kode publik), lalu generate batch voucher bila dipilih. */
  async function saveCreate() {
    const result = await createMutation.mutateAsync({
      ...campaignPayload(form),
      ...(form.code_mode === "public" && form.public_code.trim() !== "" ? { public_code: form.public_code.trim() } : {}),
    });
    if (form.code_mode !== "batch") return true;
    try {
      const generated = await generateBatchCodes(result.id, prefix, batchCount);
      toast.success(`${generated.count} voucher berhasil dibuat`);
      await refreshPromo();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Campaign dibuat, tapi generate voucher gagal — lanjut dari Kode & Riwayat"
      );
    }
    return true;
  }

  async function handleSave() {
    if (formInvalid || busy) return;
    setSaving(true);
    try {
      if (await (campaign ? saveEdit(campaign.id) : saveCreate())) onClose();
    } catch {
      // Galat mutasi sudah ditampilkan oleh hook (toast).
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogPanel size="md" className="sm:max-w-lg">
        <DialogPanelHeader>
          <DialogPanelTitle>{isEdit ? "Edit Campaign Promo" : "Buat Campaign Promo"}</DialogPanelTitle>
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
            <NumberInput
              id="promo_value"
              label={form.discount_type === "percent" ? "Persen" : "Nominal (Rp)"}
              min={1}
              max={form.discount_type === "percent" ? 100 : undefined}
              value={form.value}
              disabled={busy}
              onChange={(value) => set({ value })}
            />
          </div>

          {form.discount_type === "percent" && (
            <NumberInput
              id="promo_cap"
              label="Maks. Potongan (Rp, opsional)"
              min={1}
              placeholder="kosong = tanpa batas"
              value={form.max_discount}
              disabled={busy}
              onChange={(max_discount) => set({ max_discount })}
            />
          )}

          <div className="grid grid-cols-2 gap-3">
            <NumberInput
              id="promo_min"
              label="Min. Pembelian (Rp)"
              min={0}
              placeholder="0"
              value={form.min_purchase}
              disabled={busy}
              onChange={(min_purchase) => set({ min_purchase })}
            />
            <div className="space-y-1.5">
              <Label>Kanal Berlaku</Label>
              <Select value={form.scope} disabled={busy} onValueChange={(v) => set({ scope: v as PromoScope })}>
                <SelectTrigger className="w-full border-gray-200/80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(PROMO_SCOPE_LABELS) as [PromoScope, string][]).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DateInput id="promo_from" label="Mulai (opsional)" value={form.valid_from} disabled={busy} onChange={(valid_from) => set({ valid_from })} />
            <DateInput id="promo_until" label="Berakhir (opsional)" value={form.valid_until} disabled={busy} onChange={(valid_until) => set({ valid_until })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <NumberInput
              id="promo_limit"
              label="Kuota Total (opsional)"
              min={1}
              placeholder="tanpa batas"
              value={form.usage_limit}
              disabled={busy}
              onChange={(usage_limit) => set({ usage_limit })}
            />
            <NumberInput
              id="promo_phone_limit"
              label="Batas per Nomor WA"
              min={1}
              placeholder="bebas"
              value={form.per_phone_limit}
              disabled={busy}
              onChange={(per_phone_limit) => set({ per_phone_limit })}
            />
          </div>

          <CampaignTargetFields value={form} disabled={busy} onChange={set} />

          {isEdit ? (
            <div className="space-y-3 rounded-xl border border-gray-200/70 bg-muted/20 p-3">
              <NumberInput
                id="edit_batch_count"
                label="Jumlah Voucher"
                min={0}
                max={1000}
                value={form.batch_count}
                disabled={busy}
                onChange={(value) => set({ batch_count: digits4(value) })}
                className="bg-white"
              />
              <p className="text-xs text-muted-foreground">
                Saat ini {codesCount} voucher. Naikkan = generate dengan prefix{" "}
                <span className="font-medium text-foreground">{prefix}</span> (dari kanal{" "}
                {PROMO_SCOPE_LABELS[form.scope]}). Turunkan = hapus yang belum terpakai.
              </p>
            </div>
          ) : (
            <CodeModeFields form={form} prefix={prefix} busy={busy} set={set} />
          )}
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Batal
          </Button>
          <Button type="button" disabled={formInvalid || busy} onClick={() => void handleSave()}>
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
  );
}

function CodeModeFields({ form, prefix, busy, set }: {
  form: CampaignForm;
  prefix: string;
  busy: boolean;
  set: (patch: Partial<CampaignForm>) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-gray-200/70 bg-muted/20 p-3">
      <div className="space-y-1.5">
        <Label>Keluarkan Kode Saat Simpan</Label>
        <Select value={form.code_mode} disabled={busy} onValueChange={(v) => set({ code_mode: v as CodeMode })}>
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
          <NumberInput
            id="batch_count"
            label="Jumlah Voucher"
            min={1}
            max={1000}
            value={form.batch_count}
            disabled={busy}
            onChange={(value) => set({ batch_count: digits4(value) })}
            className="bg-white"
          />
          <p className="text-xs text-muted-foreground">
            Prefix otomatis dari kanal: <span className="font-medium text-foreground">{prefix}</span> → contoh{" "}
            {prefix}-K7M2X9. Maks 1000 per simpan.
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
            onChange={(e) => set({ public_code: e.target.value.toUpperCase() })}
            className="border-gray-200/80 bg-white"
          />
          <p className="text-xs text-muted-foreground">Satu kode yang bisa dipakai berulang sampai kuota habis.</p>
        </div>
      )}

      {form.code_mode === "none" && (
        <p className="text-xs text-muted-foreground">
          Campaign tersimpan tanpa kode. Generate nanti lewat tombol Kode & Riwayat.
        </p>
      )}
    </div>
  );
}

function NumberInput({ id, label, value, onChange, disabled, min, max, placeholder, className }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  min?: number;
  max?: number;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`border-gray-200/80 ${className ?? ""}`}
      />
    </div>
  );
}

function DateInput({ id, label, value, onChange, disabled }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="date"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="border-gray-200/80"
      />
    </div>
  );
}
