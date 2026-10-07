"use client";

import { useState } from "react";
import { Coins, Loader2, Save, Settings2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CrmSettings } from "../types";
import { topupSettingsPayload } from "../settings-forms";
import { inputClass } from "./settings-ui";

/**
 * Bonus topup & XP gratis. Pemanggil me-mount ulang lewat `key` saat
 * pengaturan server berubah, jadi draf cukup diinisialisasi sekali.
 */
export function TopupBonusSection({
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
  const [bonusPercent, setBonusPercent] = useState(() => (settings ? String(settings.topup_bonus_percent) : ""));
  const [freeXp, setFreeXp] = useState(() => (settings ? String(settings.profile_completion_free_xp) : ""));

  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings2 className="h-4 w-4 text-brand-text" />
          Bonus Topup & XP Gratis
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 p-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="bonus-topup" className="text-xs text-muted-foreground">
            <Coins className="h-3.5 w-3.5" />
            Bonus topup ARK Coin (%)
          </Label>
          <Input
            id="bonus-topup"
            type="number"
            min={0}
            max={100}
            value={bonusPercent}
            onChange={(event) => setBonusPercent(event.target.value)}
            disabled={loading || saving}
            className={inputClass}
          />
          <p className="text-xs text-muted-foreground">
            Contoh: 10% → topup 1 jt mendapat saldo 1,1 jt (bonus dicatat terpisah).
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="free-xp" className="text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            XP gratis jika profil 100% lengkap
          </Label>
          <Input
            id="free-xp"
            type="number"
            min={0}
            value={freeXp}
            onChange={(event) => setFreeXp(event.target.value)}
            disabled={loading || saving}
            className={inputClass}
          />
          <p className="text-xs text-muted-foreground">Sekali seumur hidup per member, berlaku semua tipe member.</p>
        </div>
        <Button
          type="button"
          onClick={() => onSave(topupSettingsPayload(bonusPercent, freeXp))}
          disabled={saving || loading}
          className="purchasing-main-button"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? "Menyimpan..." : "Simpan"}
        </Button>
      </CardContent>
    </Card>
  );
}
