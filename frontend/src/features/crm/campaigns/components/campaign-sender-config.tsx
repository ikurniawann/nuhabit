"use client";

import { useState } from "react";
import { MegaphoneIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useCampaignConfig, useUpdateCampaignConfig } from "../queries";

/** Master switch pengiriman + plafon global per hari. */
export function CampaignSenderConfig() {
  const config = useCampaignConfig().data;
  const updateConfig = useUpdateCampaignConfig();
  const [capEdit, setCapEdit] = useState<string | null>(null);
  const capValue = capEdit ?? (config ? String(config.daily_cap) : "");

  return (
    <PurchasingListSection
      icon={MegaphoneIcon}
      title="Pengirim"
      description="Master switch & plafon global. Menyalakan pengiriman = keputusan super admin."
    >
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-xl border border-gray-200/70 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-gray-900">Master Switch Pengiriman</p>
            <p className="text-xs text-gray-500">
              {config?.enabled
                ? "AKTIF — watcher mengirim 1 pesan per ±1 menit dalam jam 8–21 WIB"
                : "MATI — antrean menunggu; tidak ada pesan keluar (default sampai WA official siap)"}
            </p>
          </div>
          <Switch
            checked={config?.enabled ?? false}
            disabled={updateConfig.isPending || !config}
            onCheckedChange={(checked) => updateConfig.mutate({ enabled: checked })}
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
              onClick={() => updateConfig.mutate({ daily_cap: Number(capValue) })}
            >
              Simpan
            </Button>
          </div>
          <p className="text-xs text-gray-500">Lintas semua kampanye venue ini; sisa antrean lanjut besok.</p>
        </div>
      </div>
    </PurchasingListSection>
  );
}
