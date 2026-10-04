"use client";

import { useState, type FormEvent } from "react";
import { TruckIcon } from "@heroicons/react/24/outline";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormModal } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useGrnList } from "@/features/purchasing/grn/queries";
import { usePurchaseOrderList } from "@/features/purchasing/po/queries";
import { useErrorToast } from "@/features/purchasing/reports/use-error-toast";
import { formatNumber, formatRupiah } from "@/lib/format";
import {
  ADDITIONAL_COST_REFERENCE_TYPES,
  ADDITIONAL_COST_TYPE_LABELS,
  ADDITIONAL_COST_TYPES,
  buildAdditionalCostPayload,
  emptyAdditionalCostForm,
  sumCostsIdr,
  type AdditionalCost,
  type AdditionalCostForm,
  type AdditionalCostReferenceType,
  type AdditionalCostType,
} from "@/lib/purchasing/cogs-additional-cost-ui";
import { useCreateAdditionalCost, useDeleteAdditionalCost } from "../mutations";
import { useAdditionalCosts } from "../queries";

type ReferenceFilter = AdditionalCostReferenceType | "all";

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/** Jakarta date as YYYY-MM-DD for the form default. */
const todayInJakarta = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

/**
 * Biaya tambahan pembelian (freight, bea masuk, handling) per PO/GRN. Biaya
 * dialokasikan ke bahan baku yang diterima menurut nilainya, jadi ikut
 * menambah estimasi HPP resep yang memakai bahan tersebut.
 */
export function PurchaseAdditionalCostsSection() {
  const [filter, setFilter] = useState<ReferenceFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AdditionalCost | null>(null);

  const costsQuery = useAdditionalCosts(filter === "all" ? undefined : filter);
  useErrorToast(costsQuery.error, "Gagal memuat biaya tambahan");
  const deleteMutation = useDeleteAdditionalCost();
  const costs = costsQuery.data ?? [];

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      const message = await deleteMutation.mutateAsync(pendingDelete.id);
      toast.success(message || "Biaya tambahan berhasil dihapus");
      setPendingDelete(null);
    } catch (error) {
      toast.error(errorMessage(error, "Gagal menghapus biaya tambahan"));
    }
  }

  return (
    <PurchasingListSection
      icon={TruckIcon}
      title="Biaya Tambahan Pembelian"
      description="Freight, bea masuk, dan handling per PO/GRN dibagi ke bahan baku yang diterima sesuai nilainya dan ikut masuk estimasi HPP."
      toolbar={
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
          <Select value={filter} onValueChange={(value) => setFilter(value as ReferenceFilter)}>
            <SelectTrigger className="h-10 w-full border-gray-200/80 sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua dokumen</SelectItem>
              {ADDITIONAL_COST_REFERENCE_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            onClick={() => setFormOpen(true)}
            className="h-10 gap-2 rounded-lg bg-pink-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-pink-700"
          >
            <Plus className="h-4 w-4" />
            Tambah Biaya
          </Button>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Tanggal</th>
              <th className="px-4 py-3 text-left font-semibold">Dokumen</th>
              <th className="px-4 py-3 text-left font-semibold">Jenis</th>
              <th className="px-4 py-3 text-left font-semibold">Keterangan</th>
              <th className="px-4 py-3 text-right font-semibold">Nominal (Rp)</th>
              <th className="px-4 py-3 text-right font-semibold">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {costsQuery.isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                  Memuat biaya tambahan...
                </td>
              </tr>
            ) : costs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                  Belum ada biaya tambahan pembelian.
                </td>
              </tr>
            ) : (
              costs.map((cost) => (
                <tr key={cost.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap text-gray-700">{cost.tanggal_transaksi}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="border-gray-200 bg-gray-50 text-gray-700">
                        {cost.reference_type}
                      </Badge>
                      <span className="font-medium text-gray-900">{cost.reference_number ?? "-"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{ADDITIONAL_COST_TYPE_LABELS[cost.tipe_biaya] ?? cost.tipe_biaya}</td>
                  <td className="px-4 py-3 text-gray-700">{cost.deskripsi || "-"}</td>
                  <td className="px-4 py-3 text-right">
                    <p className="font-medium tabular-nums text-gray-900">{formatNumber(cost.jumlah_idr)}</p>
                    {cost.currency !== "IDR" && (
                      <p className="text-xs text-gray-500">
                        {cost.currency} {formatNumber(cost.jumlah, 2)} × {formatNumber(cost.exchange_rate, 2)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      title="Hapus biaya"
                      aria-label="Hapus biaya"
                      onClick={() => setPendingDelete(cost)}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {costs.length > 0 && (
            <tfoot className="border-t border-gray-100 bg-gray-50/70">
              <tr>
                <td colSpan={4} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Total
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-pink-700">
                  {formatRupiah(sumCostsIdr(costs))}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {formOpen && <AdditionalCostFormModal onClose={() => setFormOpen(false)} />}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Hapus biaya tambahan?"
        description={
          pendingDelete
            ? `${ADDITIONAL_COST_TYPE_LABELS[pendingDelete.tipe_biaya] ?? pendingDelete.tipe_biaya} pada ${pendingDelete.reference_type} ${pendingDelete.reference_number ?? ""} tidak lagi dihitung di HPP.`
            : undefined
        }
        confirmLabel="Hapus"
        loadingLabel="Menghapus..."
        loading={deleteMutation.isPending}
        onConfirm={() => void confirmDelete()}
        variant="danger"
      />
    </PurchasingListSection>
  );
}

/** Dibuka hanya saat menambah biaya, jadi daftar PO/GRN dimuat sesuai kebutuhan. */
function AdditionalCostFormModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<AdditionalCostForm>(() => emptyAdditionalCostForm(todayInJakarta()));
  const createMutation = useCreateAdditionalCost();
  const poQuery = usePurchaseOrderList({ limit: 100 }, form.reference_type === "PO");
  const grnQuery = useGrnList({ limit: 100 });

  const options =
    form.reference_type === "PO"
      ? (poQuery.data?.data ?? []).map((po) => ({ value: po.id, label: po.nomor_po }))
      : (grnQuery.data?.data ?? []).map((grn) => ({
          value: grn.id,
          label: grn.nomor_grn,
          description: [grn.po_number, grn.supplier_name].filter(Boolean).join(" · "),
        }));
  const update = (changes: Partial<AdditionalCostForm>) => setForm((current) => ({ ...current, ...changes }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const built = buildAdditionalCostPayload(form);
    if ("error" in built) {
      toast.error(built.error);
      return;
    }
    try {
      const message = await createMutation.mutateAsync(built.payload);
      toast.success(message || "Biaya tambahan berhasil ditambahkan");
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, "Gagal menambah biaya tambahan"));
    }
  }

  return (
    <FormModal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Tambah Biaya Tambahan"
      description="Biaya dibagi ke bahan baku yang diterima pada dokumen ini sesuai nilainya."
      size="md"
      onSubmit={submit}
      submitLabel="Simpan"
      cancelLabel="Batal"
      loadingLabel="Menyimpan..."
      loading={createMutation.isPending}
    >
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <div className="space-y-1.5">
          <Label className="text-xs text-gray-600">Dokumen</Label>
          <Select
            value={form.reference_type}
            onValueChange={(value) => update({ reference_type: value as AdditionalCostReferenceType, reference_id: "" })}
          >
            <SelectTrigger className="h-10 w-full border-gray-200/80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ADDITIONAL_COST_REFERENCE_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-gray-600">
            Nomor {form.reference_type} <span className="text-red-500">*</span>
          </Label>
          <Combobox
            options={options}
            value={form.reference_id}
            onChange={(value) => update({ reference_id: value })}
            placeholder={`Pilih ${form.reference_type}...`}
            searchPlaceholder={`Cari nomor ${form.reference_type}...`}
            emptyMessage={`${form.reference_type} tidak ditemukan`}
            className="h-10 w-full! text-sm"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-gray-600">Jenis biaya</Label>
          <Select value={form.tipe_biaya} onValueChange={(value) => update({ tipe_biaya: value as AdditionalCostType })}>
            <SelectTrigger className="h-10 w-full border-gray-200/80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ADDITIONAL_COST_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {ADDITIONAL_COST_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-gray-600">Tanggal</Label>
          <Input
            type="date"
            value={form.tanggal_transaksi}
            onChange={(event) => update({ tanggal_transaksi: event.target.value })}
            className="h-10 text-sm"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[6rem_1fr_1fr]">
        <div className="space-y-1.5">
          <Label className="text-xs text-gray-600">Mata uang</Label>
          <Input
            value={form.currency}
            maxLength={3}
            onChange={(event) => update({ currency: event.target.value.toUpperCase() })}
            className="h-10 text-sm uppercase"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-gray-600">
            Nominal <span className="text-red-500">*</span>
          </Label>
          <NumericInput value={form.jumlah} onValueChange={(value) => update({ jumlah: value })} decimalScale={2} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-gray-600">Kurs ke Rupiah</Label>
          <NumericInput
            value={form.currency === "IDR" ? 1 : form.exchange_rate}
            onValueChange={(value) => update({ exchange_rate: value })}
            decimalScale={6}
            disabled={form.currency === "IDR"}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-gray-600">Keterangan</Label>
        <Input
          value={form.deskripsi}
          onChange={(event) => update({ deskripsi: event.target.value })}
          placeholder="mis. Ongkir ekspedisi, bea masuk impor"
          className="h-10 text-sm"
        />
      </div>
    </FormModal>
  );
}
