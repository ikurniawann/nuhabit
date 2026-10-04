"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateProduct } from "../queries";
import type { ReEntryPolicy } from "../../masters/types";
import type { TicketProductDetail } from "../types";

export function PolicyTab({ detail }: { detail: TicketProductDetail }) {
  const [policy, setPolicy] = useState<ReEntryPolicy>(
    detail.product.re_entry_policy
  );
  const [hasGate, setHasGate] = useState(detail.product.has_gate);
  const [cogs, setCogs] = useState(String(detail.product.cogs ?? 0));
  const updateMutation = useUpdateProduct();

  return (
    <div className="max-w-xl space-y-5">
      <div className="flex items-start justify-between gap-3 rounded-xl border border-gray-200 p-4">
        <div>
          <Label htmlFor="has_gate" className="cursor-pointer">
            Punya gate?
          </Label>
          <p className="mt-0.5 text-xs text-gray-500">
            {hasGate
              ? "Ticket ini divalidasi di gate/turnstile."
              : "Tanpa gate — penjaga keliling mengidentifikasi pengunjung dengan reader NFC (cek sudah booking/belum)."}
          </p>
        </div>
        <Switch id="has_gate" checked={hasGate} onCheckedChange={setHasGate} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cogs">COGS / HPP (Rp)</Label>
        <Input
          id="cogs"
          type="number"
          min={0}
          step={1000}
          value={cogs}
          onChange={(e) => setCogs(e.target.value)}
        />
        <p className="text-xs text-gray-500">
          Harga pokok per ticket. Dipakai laporan untuk menghitung omzet bersih
          (laba kotor = pendapatan − COGS × jumlah terjual).
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Kebijakan Re-entry (tap gate ulang)</Label>
        <Select value={policy} onValueChange={(v) => setPolicy(v as ReEntryPolicy)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sekali-masuk">
              Sekali masuk — tap kedua ditolak
            </SelectItem>
            <SelectItem value="bebas-keluar-masuk">
              Bebas keluar-masuk — tap ulang tidak men-charge
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-gray-500">
          Berlaku per ticket ini selama kunjungan masih terbuka. Plafon
          postpaid & default mode bayar tetap diatur per venue di Pengaturan
          Tiket (melekat ke tab kunjungan, bukan produk).
        </p>
      </div>

      <Button
        onClick={() =>
          updateMutation.mutate({
            id: detail.product.id,
            values: {
              re_entry_policy: policy,
              has_gate: hasGate,
              cogs: Number(cogs) || 0,
            },
          })
        }
        disabled={updateMutation.isPending}
      >
        {updateMutation.isPending ? "Menyimpan…" : "Simpan Kebijakan"}
      </Button>
    </div>
  );
}
