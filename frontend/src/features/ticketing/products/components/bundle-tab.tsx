"use client";

// Fase P — susun komposisi paket: pilih varian tiket SATUAN Active + qty
// per 1 unit paket. Harga paket tetap diisi manual di varian "Paket"
// (tab Info & Varian); di sini ditampilkan pembanding total harga satuan
// supaya owner bisa lihat nilai "hemat"-nya.

import { useMemo, useState } from "react";
import { TrashIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatRupiah } from "@/lib/format";
import { useChannelManager, useSaveBundleItems } from "../queries";
import type { TicketProductDetail } from "../types";

interface BundleRow {
  component_variant_id: string;
  qty: number;
}

export function BundleTab({ detail }: { detail: TicketProductDetail }) {
  const { product, variants, bundle_items } = detail;
  const boardQuery = useChannelManager();

  const [rows, setRows] = useState<BundleRow[]>(
    bundle_items.map((item) => ({
      component_variant_id: item.component_variant_id,
      qty: item.qty,
    }))
  );

  // Kandidat komponen: varian dari tiket SATUAN Active milik venue
  const candidates = useMemo(() => {
    const board = boardQuery.data ?? [];
    return board
      .filter((p) => p.product_kind === "single" && p.status === "active")
      .flatMap((p) =>
        p.variants.map((v) => ({
          variant_id: v.id,
          label: `${p.name} — ${v.name}`,
          price_regular: v.price_regular,
        }))
      );
  }, [boardQuery.data]);
  const candidateById = useMemo(
    () => new Map(candidates.map((c) => [c.variant_id, c])),
    [candidates]
  );

  const mutation = useSaveBundleItems();

  const addRow = () => {
    const used = new Set(rows.map((r) => r.component_variant_id));
    const next = candidates.find((c) => !used.has(c.variant_id));
    if (!next) return;
    setRows((prev) => [
      ...prev,
      { component_variant_id: next.variant_id, qty: 1 },
    ]);
  };

  const updateRow = (index: number, patch: Partial<BundleRow>) => {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  };

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const membersPerUnit = rows.reduce((sum, r) => sum + r.qty, 0);
  const standaloneTotal = rows.reduce((sum, r) => {
    const candidate = candidateById.get(r.component_variant_id);
    return candidate?.price_regular != null
      ? sum + candidate.price_regular * r.qty
      : sum;
  }, 0);
  const bundlePrice = variants[0]?.price_regular ?? null;

  const hasDuplicate =
    new Set(rows.map((r) => r.component_variant_id)).size !== rows.length;
  const staleItems = bundle_items.filter(
    (item) => item.component_status !== "active" || !item.variant_is_active
  );
  const canSave =
    !hasDuplicate &&
    !mutation.isPending &&
    !(product.status === "active" && rows.length === 0);

  const handleSave = () => {
    if (!canSave) return;
    mutation.mutate({ id: product.id, values: { items: rows } });
  };

  if (boardQuery.isLoading) {
    return (
      <div className="py-14 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
        <p className="mt-2 text-sm text-gray-500">Memuat komposisi...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-xl border border-gray-200/70 bg-white p-5">
        <h3 className="font-semibold text-gray-900">Komposisi per 1 Unit Paket</h3>
        <p className="mt-1 text-sm text-gray-500">
          Satu unit paket = {membersPerUnit || "…"} orang/gelang. Saat dijual,
          tiap anggota mendapat tiket komponennya sendiri (kebijakan re-entry
          mengikuti tiket komponen); harga paket dialokasikan prorata ke
          anggota untuk laporan per tiket.
        </p>

        {staleItems.length > 0 ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Ada komponen tersimpan yang kini nonaktif/Draft:{" "}
            {staleItems.map((s) => `${s.product_name} — ${s.variant_name}`).join(", ")}
            . Paket tidak bisa dijual sampai komposisi dibetulkan.
          </p>
        ) : null}

        <div className="mt-4 space-y-2">
          {rows.map((row, index) => {
            const candidate = candidateById.get(row.component_variant_id);
            const saved = bundle_items.find(
              (b) => b.component_variant_id === row.component_variant_id
            );
            const label =
              candidate?.label ??
              (saved ? `${saved.product_name} — ${saved.variant_name}` : "");
            return (
              <div
                key={`${row.component_variant_id}-${index}`}
                className="flex items-center gap-2 rounded-lg border border-gray-200/70 px-3 py-2"
              >
                <Select
                  value={row.component_variant_id}
                  onValueChange={(v) =>
                    updateRow(index, { component_variant_id: v })
                  }
                >
                  <SelectTrigger className="h-9 min-w-0 flex-1">
                    <SelectValue placeholder={label || "Pilih tiket satuan"} />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((c) => (
                      <SelectItem key={c.variant_id} value={c.variant_id}>
                        {c.label}
                        {c.price_regular != null
                          ? ` (${formatRupiah(c.price_regular)})`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1.5">
                  <Label
                    htmlFor={`bundle_qty_${index}`}
                    className="text-xs text-gray-500"
                  >
                    ×
                  </Label>
                  <Input
                    id={`bundle_qty_${index}`}
                    type="number"
                    min={1}
                    max={20}
                    value={row.qty}
                    onChange={(e) =>
                      updateRow(index, {
                        qty: Math.max(
                          1,
                          Math.min(20, Number(e.target.value) || 1)
                        ),
                      })
                    }
                    className="h-9 w-16 text-center"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => removeRow(index)}
                  className="h-8 w-8 p-0 text-gray-400 hover:bg-red-50 hover:text-red-600"
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
          {rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-xs text-gray-400">
              Belum ada komponen — tambah tiket satuan penyusun paket
            </p>
          ) : null}
        </div>

        {hasDuplicate ? (
          <p className="mt-2 text-xs text-red-600">
            Ada komponen yang sama dipilih dua kali — gabungkan lewat qty.
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addRow}
            disabled={candidates.length === 0}
          >
            Tambah Komponen
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={!canSave}
          >
            {mutation.isPending ? "Menyimpan…" : "Simpan Komposisi"}
          </Button>
        </div>
        {candidates.length === 0 ? (
          <p className="mt-2 text-xs text-amber-600">
            Belum ada tiket satuan Active — aktifkan tiket satuan dulu di
            Master Ticket.
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-gray-200/70 bg-white p-5 text-sm">
        <h3 className="font-semibold text-gray-900">Pembanding Harga (Regular)</h3>
        <dl className="mt-2 space-y-1.5">
          <div className="flex justify-between">
            <dt className="text-gray-500">Total harga satuan komponen</dt>
            <dd className="tabular-nums text-gray-900">
              {standaloneTotal > 0 ? formatRupiah(standaloneTotal) : "—"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Harga paket (varian “Paket”)</dt>
            <dd className="tabular-nums text-gray-900">
              {bundlePrice != null ? formatRupiah(bundlePrice) : "belum diisi"}
            </dd>
          </div>
          {bundlePrice != null && standaloneTotal > bundlePrice ? (
            <div className="flex justify-between font-medium text-emerald-700">
              <dt>Hemat untuk pengunjung</dt>
              <dd className="tabular-nums">
                {formatRupiah(standaloneTotal - bundlePrice)}
              </dd>
            </div>
          ) : null}
        </dl>
        <p className="mt-2 text-xs text-gray-500">
          Harga paket diisi di tab Info & Varian (Regular & High Season) dan
          bisa di-override per kanal di Channel Manager — sama seperti tiket
          satuan.
        </p>
      </div>
    </div>
  );
}
