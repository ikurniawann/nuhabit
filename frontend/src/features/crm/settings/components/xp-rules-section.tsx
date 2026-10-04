"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Gift, Loader2, Pencil, Plus, Save } from "lucide-react";
import { formatNumber, formatRupiah } from "@/lib/format";
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
import { Label } from "@/components/ui/label";
import type { CrmXpRuleConfig } from "../types";
import { EMPTY_RULE_FORM, XP_MODE_LABELS, ruleFormToPayload, ruleToForm, type RuleForm } from "../settings-forms";
import { useSaveCrmXpRule } from "../queries";
import { ActiveBadge, LabeledInput, SwitchRow, TableMessageRow, inputClass, thClass } from "./settings-ui";

type Editing = { form: RuleForm; isNew: boolean };

export function XpRulesSection({ rules, loading }: { rules: CrmXpRuleConfig[]; loading: boolean }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const saveMutation = useSaveCrmXpRule(() => setEditing(null));
  const form = editing?.form ?? null;

  function submit() {
    if (!form || saveMutation.isPending) return;
    if (!form.code.trim() || !form.name.trim()) {
      toast.error("Kode dan nama aturan XP wajib diisi");
      return;
    }
    saveMutation.mutate(ruleFormToPayload(form));
  }

  const patch = (value: Partial<RuleForm>) =>
    setEditing((current) => current && { ...current, form: { ...current.form, ...value } });

  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="flex flex-row items-center justify-between border-b border-gray-200/70 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gift className="h-4 w-4 text-brand-text" />
          Aturan XP (POS)
        </CardTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEditing({ form: EMPTY_RULE_FORM, isNew: true })}
          className="purchasing-secondary-button h-9"
        >
          <Plus className="h-3.5 w-3.5" />
          Aturan baru
        </Button>
      </CardHeader>
      <p className="px-4 pt-3 text-xs text-muted-foreground">
        XP hanya diberikan untuk pembayaran penuh dengan ARK Coin. Aturan menentukan besaran XP per transaksi/produk.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className={`${thClass} text-left`}>Aturan</th>
              <th className={`${thClass} text-left`}>Sumber</th>
              <th className={`${thClass} text-left`}>Mode</th>
              <th className={`${thClass} text-right`}>Nilai XP</th>
              <th className={`${thClass} text-right`}>Per Nominal</th>
              <th className={`${thClass} text-left`}>Status</th>
              <th className={`${thClass} text-right`}>Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <TableMessageRow colSpan={7}>Memuat aturan XP...</TableMessageRow>
            ) : rules.length === 0 ? (
              <TableMessageRow colSpan={7}>
                Belum ada aturan XP — tanpa aturan, transaksi ARK Coin tidak menghasilkan XP.
              </TableMessageRow>
            ) : (
              rules.map((rule) => (
                <tr key={rule.code} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{rule.name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {rule.code} · prio {rule.priority}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {rule.source_type === "product" ? "Produk" : "Nominal order"}
                  </td>
                  <td className="px-4 py-3 text-foreground">{XP_MODE_LABELS[rule.xp_mode] ?? rule.xp_mode}</td>
                  <td className="px-4 py-3 text-right font-medium text-emerald-700">{formatNumber(rule.xp_value)}</td>
                  <td className="px-4 py-3 text-right text-foreground">
                    {rule.xp_mode === "per_amount" ? formatRupiah(Number(rule.amount_step) || 1) : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <ActiveBadge active={rule.is_active !== false} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing({ form: ruleToForm(rule), isNew: false })}
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
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open && !saveMutation.isPending) setEditing(null);
        }}
      >
        <DialogPanel size="lg">
          <DialogPanelHeader>
            <DialogPanelTitle>{editing?.isNew ? "Aturan XP baru" : `Ubah aturan: ${form?.code}`}</DialogPanelTitle>
            <DialogPanelDescription>Tentukan sumber, mode, dan nilai XP untuk pembayaran ARK Coin.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid gap-4 sm:grid-cols-2">
            <LabeledInput
              id="rule-code"
              type="text"
              label="Kode"
              value={form?.code ?? ""}
              onChange={(code) => patch({ code })}
              disabled={!editing?.isNew}
              placeholder="pos-order-amount"
            />
            <LabeledInput
              id="rule-name"
              type="text"
              label="Nama"
              value={form?.name ?? ""}
              onChange={(name) => patch({ name })}
              placeholder="XP per belanja"
            />
            <div className="space-y-1.5">
              <Label htmlFor="rule-source" className="text-xs text-muted-foreground">
                Sumber
              </Label>
              <select
                id="rule-source"
                value={form?.source_type ?? "order_amount"}
                onChange={(event) => patch({ source_type: event.target.value })}
                className={`w-full rounded-lg px-3 text-sm ${inputClass}`}
              >
                <option value="order_amount">Nominal order</option>
                <option value="product">Produk</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-mode" className="text-xs text-muted-foreground">
                Mode
              </Label>
              <select
                id="rule-mode"
                value={form?.xp_mode ?? "per_amount"}
                onChange={(event) => patch({ xp_mode: event.target.value as RuleForm["xp_mode"] })}
                className={`w-full rounded-lg px-3 text-sm ${inputClass}`}
              >
                {Object.entries(XP_MODE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <LabeledInput
              id="rule-xp"
              label="Nilai XP"
              min={0}
              value={form?.xp_value ?? ""}
              onChange={(xp_value) => patch({ xp_value })}
            />
            <LabeledInput
              id="rule-step"
              label="Step nominal (Rp)"
              min={1}
              value={form?.amount_step ?? ""}
              onChange={(amount_step) => patch({ amount_step })}
              disabled={form?.xp_mode !== "per_amount"}
            />
            <LabeledInput
              id="rule-min"
              label="Min transaksi (Rp)"
              min={0}
              value={form?.min_amount ?? ""}
              onChange={(min_amount) => patch({ min_amount })}
            />
            <LabeledInput
              id="rule-max"
              label="Maks XP per transaksi"
              min={0}
              value={form?.max_xp_per_event ?? ""}
              onChange={(max_xp_per_event) => patch({ max_xp_per_event })}
              placeholder="Tanpa batas"
            />
            <SwitchRow
              label="Kalikan pengali tier"
              checked={form?.tier_multiplier_enabled ?? false}
              onChange={(tier_multiplier_enabled) => patch({ tier_multiplier_enabled })}
            />
            <SwitchRow
              label="Aturan aktif"
              checked={form?.is_active ?? false}
              onChange={(is_active) => patch({ is_active })}
            />
          </DialogPanelBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(null)}
              disabled={saveMutation.isPending}
              className="h-10 rounded-lg border-gray-200/80"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={saveMutation.isPending || !form?.code.trim() || !form?.name.trim()}
              className="purchasing-main-button"
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saveMutation.isPending ? "Menyimpan..." : "Simpan aturan"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </Card>
  );
}
