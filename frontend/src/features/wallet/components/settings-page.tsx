"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { formatRupiah } from "@/lib/format";
import { walletApi, type WalletSettings } from "../api";
import { SweepPanel } from "./sweep-panel";

const SETTINGS_KEY = ["wallet", "settings"];

/** POS → Member → Aturan Saldo: masa berlaku default, pengingat, saldo rendah, batas top-up portal. */
export function WalletSettingsPage() {
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: walletApi.settings });

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="POS · Member"
        title="Aturan Saldo"
        description="Masa berlaku saldo, pengingat sebelum kedaluwarsa, dan dorongan saat saldo member menipis."
      />

      <Card className="p-5">
        {settings.isLoading ? (
          <TableNote>Memuat aturan…</TableNote>
        ) : settings.error ? (
          <TableNote tone="danger">{settings.error.message}</TableNote>
        ) : settings.data ? (
          <SettingsForm initial={settings.data} />
        ) : null}
      </Card>

      <SweepPanel />
    </div>
  );
}

function SettingsForm({ initial }: { initial: WalletSettings }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    validity: initial.wallet_default_validity_days ? String(initial.wallet_default_validity_days) : "",
    reminder: String(initial.wallet_expiry_reminder_days),
    threshold: String(initial.low_balance_threshold_idr),
    max: String(initial.topup_max_amount),
  });

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((cur) => ({ ...cur, [key]: e.target.value }));

  const save = useMutation({
    mutationFn: () =>
      walletApi.saveSettings({
        wallet_default_validity_days: form.validity ? Number(form.validity) : null,
        wallet_expiry_reminder_days: Number(form.reminder) || 0,
        low_balance_threshold_idr: Number(form.threshold) || 0,
        topup_max_amount: Number(form.max) || 0,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_KEY, data);
      toast.success("Aturan saldo disimpan");
    },
    onError: (error) => toast.error("Aturan saldo gagal disimpan", { description: error.message }),
  });

  return (
    <form
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field
        label="Masa berlaku default (hari)"
        hint="Untuk top-up bebas, bonus, refund order, dan penyesuaian plus. Kosong = tidak kedaluwarsa. Paket memakai masa berlakunya sendiri."
      >
        <Input type="number" min={1} value={form.validity} onChange={set("validity")} placeholder="Tidak kedaluwarsa" />
      </Field>
      <Field label="Ingatkan sebelum kedaluwarsa (hari)" hint="0 = tanpa pengingat. Dikirim sekali per lot lewat WhatsApp dan notifikasi portal.">
        <Input type="number" min={0} max={90} value={form.reminder} onChange={set("reminder")} />
      </Field>
      <Field
        label="Ambang saldo rendah (Rp)"
        hint={`0 = nonaktif. Member yang saldonya turun di bawah ${formatRupiah(Number(form.threshold) || 0)} dikabari, maksimal sekali per 7 hari.`}
      >
        <Input type="number" min={0} step={1_000} value={form.threshold} onChange={set("threshold")} />
      </Field>
      <Field label="Maksimal top-up portal (Rp)" hint="Batas nominal bebas yang bisa diisi member sendiri. 0 = tanpa batas.">
        <Input type="number" min={0} step={1_000} value={form.max} onChange={set("max")} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={save.isPending}>
          Simpan aturan
        </Button>
      </div>
    </form>
  );
}
