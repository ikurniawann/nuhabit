"use client";

import { Coins, Loader2, Sparkles, ToggleRight } from "lucide-react";
import type { CrmSettings } from "../types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Saklar fitur ARK Coin & XP. Disimpan langsung saat diubah — efeknya ke menu
 * (sidebar, desktop, POS) terlihat setelah halaman dimuat ulang, jadi
 * pemanggil me-refresh route setelah sukses.
 */
export function LoyaltyFeaturesSection({
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
  const disabled = loading || saving || !settings;
  const arkCoin = settings?.ark_coin_enabled ?? true;
  const xp = settings?.xp_enabled ?? true;

  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ToggleRight className="h-4 w-4 text-brand-text" />
          Fitur Loyalty
          {saving ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 p-4 md:grid-cols-2">
        <FeatureRow
          icon={<Coins className="h-4 w-4 text-muted-foreground" />}
          title="ARK Coin"
          checked={arkCoin}
          disabled={disabled}
          onChange={(checked) => onSave({ ark_coin_enabled: checked })}
          on="Menu Topup & Unlink Card tampil di POS, metode bayar ARK Coin tersedia di kasir."
          off="Menu Topup & Unlink Card disembunyikan, metode bayar ARK Coin hilang dari kasir, dan transaksi memakai saldo ARK ditolak."
        />
        <FeatureRow
          icon={<Sparkles className="h-4 w-4 text-muted-foreground" />}
          title="XP"
          checked={xp}
          disabled={disabled}
          onChange={(checked) => onSave({ xp_enabled: checked })}
          on="Menu Rewards, Avatars & Badges tampil; XP member & produk khusus min XP aktif di kasir."
          off="Menu Rewards, Avatars & Badges disembunyikan; kasir tidak menampilkan XP dan tidak mengunci produk min XP."
        />
        <p className="text-xs text-muted-foreground md:col-span-2">
          Menonaktifkan fitur tidak menghapus data — saldo ARK dan riwayat XP member tetap tersimpan dan
          kembali tampil saat fitur diaktifkan lagi. Menu &quot;ARK &amp; XP&quot; di POS tampil selama
          salah satu fitur aktif.
        </p>
      </CardContent>
    </Card>
  );
}

function FeatureRow({
  icon,
  title,
  checked,
  disabled,
  onChange,
  on,
  off,
}: {
  icon: React.ReactNode;
  title: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  on: string;
  off: string;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-gray-200/70 bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <Label className="flex items-center gap-2 text-sm text-foreground">
          {icon}
          {title}
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              checked ? "bg-emerald-100 text-emerald-700" : "bg-gray-200 text-gray-600"
            }`}
          >
            {checked ? "Aktif" : "Nonaktif"}
          </span>
        </Label>
        <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={`Aktifkan ${title}`} />
      </div>
      <p className="text-xs text-muted-foreground">{checked ? on : off}</p>
    </div>
  );
}
