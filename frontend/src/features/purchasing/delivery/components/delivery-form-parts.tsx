"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TruckIcon } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DsDateTimePicker } from "@/components/design-system";
import { todayIsoDate } from "@/lib/purchasing/po-ui-detail";
import type { DeliveryFormFields } from "@/lib/purchasing/receiving-ui-delivery";

type PoOption = { id: string; nomor_po: string; nama_supplier?: string | null };

/**
 * State form pengiriman. `?po_id=` dari URL memilih PO awal bila PO itu ada di
 * daftar opsi; bila tidak, pengguna diberi tahu dan memilih sendiri.
 */
export function useDeliveryDraft<T extends PoOption>(poList: T[], optionsLoaded: boolean) {
  const presetPoId = useSearchParams().get("po_id");
  const [poChoice, setPoChoice] = useState(presetPoId ?? "");
  const [fields, setFields] = useState<DeliveryFormFields>(() => ({
    no_surat_jalan: "",
    kurir: "",
    no_resi: "",
    tanggal_kirim: todayIsoDate(),
    tanggal_estimasi_tiba: "",
    catatan: "",
  }));

  const selectedPO = poList.find((po) => po.id === poChoice);
  const presetMissing = Boolean(presetPoId) && optionsLoaded && !poList.some((po) => po.id === presetPoId);

  useEffect(() => {
    if (presetMissing) {
      toast.error("Purchase order ini sudah memiliki pengiriman atau tidak memenuhi syarat.", {
        id: "delivery-preset-po",
      });
    }
  }, [presetMissing]);

  return {
    presetPoId,
    selectedPO,
    poId: selectedPO?.id ?? "",
    setPoId: setPoChoice,
    fields,
    setField: <K extends keyof DeliveryFormFields>(key: K, value: DeliveryFormFields[K]) =>
      setFields((prev) => ({ ...prev, [key]: value })),
  };
}

type CardProps = {
  poList: PoOption[];
  poId: string;
  onPoChange: (poId: string) => void;
  fetchingPOs: boolean;
  /** PO dikunci saat halaman dibuka dari detail PO. */
  poLocked?: boolean;
  partyLabel: "supplier" | "vendor";
  fields: DeliveryFormFields;
  setField: <K extends keyof DeliveryFormFields>(key: K, value: DeliveryFormFields[K]) => void;
};

export function DeliveryInfoCard({ poList, poId, onPoChange, fetchingPOs, poLocked = false, partyLabel, fields, setField }: CardProps) {
  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TruckIcon className="h-4 w-4" />
          Informasi Pengiriman
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs">
            Purchase Order <span className="text-red-500">*</span>
          </Label>
          <Combobox
            options={poList.map((po) => ({ value: po.id, label: po.nomor_po, description: po.nama_supplier ?? undefined }))}
            value={poId}
            onChange={onPoChange}
            placeholder={fetchingPOs ? "Memuat purchase order..." : "Pilih purchase order"}
            searchPlaceholder={`Cari purchase order atau ${partyLabel}...`}
            emptyMessage="Tidak ada purchase order yang memenuhi syarat"
            allowClear={!poLocked}
            disabled={fetchingPOs || poLocked}
            className="w-full! h-9 text-sm"
          />
          {poLocked && (
            <p className="text-xs text-muted-foreground">Purchase order dikunci karena halaman ini dibuka dari detail PO.</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="no_surat_jalan" className="text-xs">
              Nomor Surat Jalan <span className="text-red-500">*</span>
            </Label>
            <Input
              id="no_surat_jalan"
              placeholder="Contoh: DN-2025-0001"
              value={fields.no_surat_jalan}
              onChange={(e) => setField("no_surat_jalan", e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="no_resi" className="text-xs">
              Nomor Resi
            </Label>
            <Input
              id="no_resi"
              placeholder="Contoh: JNE123456789"
              value={fields.no_resi}
              onChange={(e) => setField("no_resi", e.target.value)}
              className="h-9 text-sm"
            />
          </div>
        </div>

        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="kurir" className="text-xs">
            Ekspedisi / Perusahaan Pengiriman
          </Label>
          <Input
            id="kurir"
            placeholder="Contoh: JNE, J&T, SiCepat"
            value={fields.kurir}
            onChange={(e) => setField("kurir", e.target.value)}
            className="h-9 text-sm"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <DsDateTimePicker
            label="Tanggal Kirim"
            value={fields.tanggal_kirim}
            onChange={(v) => setField("tanggal_kirim", v)}
            placeholder="Pilih tanggal kirim..."
            dateOnly
            required
          />
          <DsDateTimePicker
            label="Estimasi Tanggal Tiba"
            value={fields.tanggal_estimasi_tiba}
            onChange={(v) => setField("tanggal_estimasi_tiba", v)}
            placeholder="Pilih estimasi tanggal tiba..."
            dateOnly
            required
          />
        </div>

        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="catatan" className="text-xs">
            Catatan
          </Label>
          <Textarea
            id="catatan"
            placeholder="Tambahkan catatan bila diperlukan..."
            value={fields.catatan}
            onChange={(e) => setField("catatan", e.target.value)}
            rows={3}
            className="resize-none text-sm"
          />
        </div>
      </CardContent>
    </Card>
  );
}
