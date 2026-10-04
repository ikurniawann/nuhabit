"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SalesTargetConfig } from "@/lib/dashboard/sales-target";
import { saveSalesTarget } from "../api";

export function TargetEditor({
  target,
  onSaved,
}: {
  target: SalesTargetConfig;
  onSaved: (next: SalesTargetConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const [harian, setHarian] = useState("");
  const [bulanan, setBulanan] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) {
    return (
      <Button
        variant="soft"
        size="sm"
        onClick={() => {
          setHarian(target.harianRp ? String(target.harianRp) : "");
          setBulanan(target.bulananRp ? String(target.bulananRp) : "");
          setOpen(true);
        }}
      >
        Atur target
      </Button>
    );
  }

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      onSaved(
        await saveSalesTarget({
          harianRp: harian || 0,
          bulananRp: bulanan || 0,
        }),
      );
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl bg-surface-2 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-foreground">
          Target harian (Rp)
          <Input
            value={harian}
            onChange={(e) => setHarian(e.target.value)}
            inputMode="numeric"
            placeholder="mis. 5000000"
            className="mt-1.5"
          />
        </label>
        <label className="text-sm font-medium text-foreground">
          Target bulanan (Rp)
          <Input
            value={bulanan}
            onChange={(e) => setBulanan(e.target.value)}
            inputMode="numeric"
            placeholder="mis. 120000000"
            className="mt-1.5"
          />
        </label>
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Menyimpan…" : "Simpan target"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Batal
        </Button>
      </div>
    </div>
  );
}
