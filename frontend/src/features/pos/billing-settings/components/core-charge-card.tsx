"use client";

import { Percent } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { BillingCharge } from "@/lib/pos/billing-settings";

export function CoreChargeCard({
  title,
  description,
  icon: Icon,
  charge,
  onChange,
}: {
  title: string;
  description: string;
  icon: typeof Percent;
  charge: BillingCharge;
  onChange: (patch: Partial<BillingCharge>) => void;
}) {
  return (
    <div className="rounded-2xl border border-gray-200/70 bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-brand-text">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Aktif</span>
          <Switch
            checked={charge.is_enabled}
            onCheckedChange={(checked) => onChange({ is_enabled: checked })}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-sm font-medium">Label di kasir</span>
          <Input
            value={charge.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="h-10 border-gray-200/80"
            disabled={!charge.is_enabled}
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-medium">Tarif (%)</span>
          <Input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={charge.rate}
            onChange={(e) =>
              onChange({
                calc_method: "percent",
                rate: Number(e.target.value) || 0,
              })
            }
            className="h-10 border-gray-200/80"
            disabled={!charge.is_enabled}
          />
        </label>
      </div>

      <label className="flex items-center justify-between gap-3 rounded-xl border border-gray-200/70 bg-muted/30 px-3 py-2.5">
        <div>
          <div className="text-sm font-medium text-foreground">Opsional di kasir</div>
          <div className="text-xs text-muted-foreground">
            Kasir bisa centang/hilangkan per transaksi
          </div>
        </div>
        <Switch
          checked={charge.is_optional}
          onCheckedChange={(checked) => onChange({ is_optional: checked })}
          disabled={!charge.is_enabled}
        />
      </label>
    </div>
  );
}
