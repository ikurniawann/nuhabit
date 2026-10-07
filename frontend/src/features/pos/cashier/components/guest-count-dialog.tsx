"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { capacityWarning, normalizeGuestCount } from "@/lib/pos/guest-count";

/**
 * Jumlah tamu (EPIC-038): tombol cepat untuk kasus umum, isian untuk
 * rombongan. Draft baru disimpan saat Simpan, jadi Batal tidak mengubah
 * angka yang sudah benar. Peringatan kapasitas memberi tahu, tidak memblokir.
 */
function GuestCountForm(props: {
  initial: string;
  capacity: number | null;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(props.initial);
  const warning = capacityWarning(normalizeGuestCount(draft), props.capacity);
  return (
    <DialogPanelBody>
      <div className="flex flex-wrap gap-2">
        {[1, 2, 4, 6].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setDraft(String(n))}
            className={`min-w-11 rounded-lg border px-3 py-2 text-sm font-semibold ${
              normalizeGuestCount(draft) === n
                ? "border-primary bg-primary/10 text-brand-text"
                : "border-gray-300 text-gray-700 hover:border-primary hover:text-brand-text"
            }`}
          >
            {n}
          </button>
        ))}
      </div>

      <Input
        type="number"
        min={1}
        inputMode="numeric"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") props.onSave(draft);
        }}
        placeholder="Jumlah lain"
        aria-label="Jumlah tamu"
        className="mt-3"
      />

      {warning ? <p className="mt-2 text-xs text-amber-700">{warning}</p> : null}

      <p className="mt-2 text-xs text-gray-500">Dikosongkan berarti 1 orang.</p>

      <div className="mt-4 flex gap-2">
        <Button variant="outline" className="flex-1" onClick={props.onCancel}>
          Batal
        </Button>
        <Button className="flex-1" onClick={() => props.onSave(draft)}>
          Simpan
        </Button>
      </div>
    </DialogPanelBody>
  );
}

export function GuestCountDialog(props: {
  open: boolean;
  value: string;
  tableLabel: string | null;
  capacity: number | null;
  onOpenChange: (open: boolean) => void;
  onSave: (value: string) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>Jumlah Tamu</DialogPanelTitle>
          <DialogPanelDescription>
            {props.tableLabel
              ? `Meja ${props.tableLabel}${props.capacity ? ` · kapasitas ${props.capacity} kursi` : ""}`
              : "Berapa orang untuk pesanan ini?"}
          </DialogPanelDescription>
        </DialogPanelHeader>
        {props.open ? (
          <GuestCountForm
            initial={props.value}
            capacity={props.capacity}
            onSave={(value) => {
              props.onSave(value);
              props.onOpenChange(false);
            }}
            onCancel={() => props.onOpenChange(false)}
          />
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}
