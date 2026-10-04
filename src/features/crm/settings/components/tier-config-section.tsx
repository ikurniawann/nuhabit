"use client";

import { useState } from "react";
import { Crown, Loader2, Pencil, Save } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import type { CrmTierConfig } from "../types";
import { tierFormToPayload, tierToForm, type TierForm } from "../settings-forms";
import { useSaveCrmTier } from "../queries";
import { ActiveBadge, LabeledInput, SwitchRow, TableMessageRow, thClass } from "./settings-ui";

export function TierConfigSection({ tiers, loading }: { tiers: CrmTierConfig[]; loading: boolean }) {
  const [form, setForm] = useState<TierForm | null>(null);
  const saveMutation = useSaveCrmTier(() => setForm(null));

  function submit() {
    if (!form || saveMutation.isPending) return;
    saveMutation.mutate(tierFormToPayload(form, tiers.find((tier) => tier.code === form.code)));
  }

  const patch = (value: Partial<TierForm>) => setForm((current) => current && { ...current, ...value });

  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="flex flex-row items-center justify-between border-b border-gray-200/70 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Crown className="h-4 w-4 text-brand-text" />
          Tier Membership
        </CardTitle>
        <p className="text-xs text-muted-foreground">Ditentukan dari lifetime XP (ambang min XP).</p>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className={`${thClass} text-left`}>Tier</th>
              <th className={`${thClass} text-right`}>Min Lifetime XP</th>
              <th className={`${thClass} text-right`}>Diskon (%)</th>
              <th className={`${thClass} text-right`}>Pengali XP</th>
              <th className={`${thClass} text-left`}>Status</th>
              <th className={`${thClass} text-right`}>Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <TableMessageRow colSpan={6}>Memuat tier...</TableMessageRow>
            ) : tiers.length === 0 ? (
              <TableMessageRow colSpan={6}>Belum ada tier.</TableMessageRow>
            ) : (
              tiers.map((tier) => (
                <tr key={tier.code} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{tier.name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      urutan {tier.rank} · {tier.code}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-foreground">{formatNumber(tier.min_lifetime_xp)}</td>
                  <td className="px-4 py-3 text-right font-medium text-emerald-700">
                    {Number(tier.discount_percent) || 0}%
                  </td>
                  <td className="px-4 py-3 text-right text-foreground">{Number(tier.xp_multiplier) || 1}x</td>
                  <td className="px-4 py-3">
                    <ActiveBadge active={tier.is_active !== false} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setForm(tierToForm(tier))}
                      className="cursor-pointer"
                    >
                      <Pencil className="h-4 w-4" />
                      Ubah
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog
        open={Boolean(form)}
        onOpenChange={(open) => {
          if (!open && !saveMutation.isPending) setForm(null);
        }}
      >
        <DialogPanel size="md">
          <DialogPanelHeader>
            <DialogPanelTitle>Ubah tier: {form?.code}</DialogPanelTitle>
            <DialogPanelDescription>Ambang XP, diskon, dan pengali XP untuk tier ini.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid gap-4 sm:grid-cols-2">
            <LabeledInput
              id="tier-name"
              type="text"
              label="Nama tier"
              className="sm:col-span-2"
              value={form?.name ?? ""}
              onChange={(name) => patch({ name })}
            />
            <LabeledInput
              id="tier-min-xp"
              label="Min lifetime XP"
              min={0}
              value={form?.min_lifetime_xp ?? ""}
              onChange={(min_lifetime_xp) => patch({ min_lifetime_xp })}
            />
            <LabeledInput
              id="tier-discount"
              label="Diskon (%)"
              min={0}
              max={100}
              value={form?.discount_percent ?? ""}
              onChange={(discount_percent) => patch({ discount_percent })}
            />
            <LabeledInput
              id="tier-multiplier"
              label="Pengali XP"
              min={0}
              step={0.1}
              value={form?.xp_multiplier ?? ""}
              onChange={(xp_multiplier) => patch({ xp_multiplier })}
            />
            <SwitchRow
              id="tier-active"
              label="Tier aktif"
              checked={form?.is_active ?? false}
              onChange={(is_active) => patch({ is_active })}
            />
          </DialogPanelBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setForm(null)}
              disabled={saveMutation.isPending}
              className="h-10 rounded-lg border-gray-200/80"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={saveMutation.isPending || !form?.name.trim()}
              className="purchasing-main-button"
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saveMutation.isPending ? "Menyimpan..." : "Simpan tier"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </Card>
  );
}
