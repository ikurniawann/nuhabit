"use client";

// Bagian form penawaran: channel, kuota, eksklusif/prioritas, kode pembuka.

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SALES_CHANNEL_CODES, SALES_CHANNEL_LABELS } from "@/lib/pos/sales-channels";

export interface OfferLimitsDraft {
  /** Kosong = semua channel. */
  sales_channels: string[];
  max_uses: string;
  max_uses_per_member: string;
  is_exclusive: boolean;
  priority: string;
  unlock_code: string;
}

export const EMPTY_OFFER_LIMITS: OfferLimitsDraft = {
  sales_channels: [],
  max_uses: "",
  max_uses_per_member: "",
  is_exclusive: false,
  priority: "0",
  unlock_code: "",
};

const toPositiveIntOrNull = (raw: string) => {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isInteger(n) && n > 0 ? n : null;
};

export function offerLimitsPayload(draft: OfferLimitsDraft) {
  return {
    sales_channels: draft.sales_channels.length > 0 ? draft.sales_channels : null,
    max_uses: toPositiveIntOrNull(draft.max_uses),
    max_uses_per_member: toPositiveIntOrNull(draft.max_uses_per_member),
    is_exclusive: draft.is_exclusive,
    priority: Math.min(1000, Math.max(0, Math.floor(Number(draft.priority) || 0))),
    unlock_code: draft.unlock_code.trim().toUpperCase() || null,
  };
}

export function OfferLimitsFields({
  value,
  onChange,
}: {
  value: OfferLimitsDraft;
  onChange: (patch: Partial<OfferLimitsDraft>) => void;
}) {
  const toggleChannel = (code: string, on: boolean) =>
    onChange({
      sales_channels: on
        ? [...value.sales_channels, code]
        : value.sales_channels.filter((c) => c !== code),
    });

  return (
    <div className="space-y-4 rounded-xl bg-surface-2 p-3">
      <div>
        <p className="text-sm font-semibold text-foreground">Batas &amp; penggabungan</p>
        <p className="text-xs text-muted-foreground">
          Penawaran eksklusif tidak digabung dengan penawaran lain: sistem memilih mana yang lebih
          hemat untuk pembeli, eksklusif sendirian atau gabungan sisanya. Prioritas lebih tinggi
          diproses lebih dulu.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Channel penjualan</Label>
        <div className="flex flex-wrap gap-3">
          {SALES_CHANNEL_CODES.map((code) => (
            <label key={code} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={value.sales_channels.includes(code)}
                onChange={(e) => toggleChannel(code, e.target.checked)}
              />
              {SALES_CHANNEL_LABELS[code]}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Tidak dicentang semua = berlaku di semua channel.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="offer_max_uses">Kuota total</Label>
          <Input
            id="offer_max_uses"
            inputMode="numeric"
            placeholder="tanpa batas"
            value={value.max_uses}
            onChange={(e) => onChange({ max_uses: e.target.value.replace(/\D/g, "") })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="offer_max_member">Kuota per member</Label>
          <Input
            id="offer_max_member"
            inputMode="numeric"
            placeholder="tanpa batas"
            value={value.max_uses_per_member}
            onChange={(e) => onChange({ max_uses_per_member: e.target.value.replace(/\D/g, "") })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="offer_priority">Prioritas (0–1000)</Label>
          <Input
            id="offer_priority"
            inputMode="numeric"
            value={value.priority}
            onChange={(e) => onChange({ priority: e.target.value.replace(/\D/g, "") })}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-card px-3 py-2.5">
          <div>
            <div className="text-sm font-medium">Eksklusif</div>
            <div className="text-xs text-muted-foreground">Tidak bisa digabung</div>
          </div>
          <Switch
            checked={value.is_exclusive}
            onCheckedChange={(checked) => onChange({ is_exclusive: checked })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="offer_unlock_code">Kode pembuka (opsional)</Label>
          <Input
            id="offer_unlock_code"
            placeholder="mis. HYROX100"
            value={value.unlock_code}
            maxLength={40}
            onChange={(e) => onChange({ unlock_code: e.target.value.toUpperCase() })}
          />
          <p className="text-xs text-muted-foreground">
            Diisi = penawaran baru aktif setelah kasir mengetik kode ini di kolom kode promo.
          </p>
        </div>
      </div>
    </div>
  );
}
