"use client";

import { useState } from "react";
import Link from "next/link";
import { GlobeAltIcon, TicketIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TableRow } from "@/components/ui/table";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { formatRupiah } from "@/lib/format";
import {
  useChannelManager,
  useSaveChannelPrices,
  useToggleChannel,
} from "../queries";
import type { ChannelManagerChannel, ChannelManagerItem } from "../types";

interface PriceDialogState {
  product: ChannelManagerItem;
  channel: ChannelManagerChannel;
}

interface OverrideForm {
  variant_id: string;
  price_regular: string;
  price_high: string;
}

export function ChannelManagerPage() {
  const boardQuery = useChannelManager();
  const items = boardQuery.data ?? [];
  const toggleMutation = useToggleChannel();

  const [priceDialog, setPriceDialog] = useState<PriceDialogState | null>(null);
  const [overrideForms, setOverrideForms] = useState<OverrideForm[]>([]);

  const savePricesMutation = useSaveChannelPrices(() => setPriceDialog(null));

  const openPriceDialog = (product: ChannelManagerItem, channel: ChannelManagerChannel) => {
    setPriceDialog({ product, channel });
    setOverrideForms(
      channel.overrides.map((o) => ({
        variant_id: o.variant_id,
        price_regular: o.price_regular === null ? "" : String(o.price_regular),
        price_high: o.price_high === null ? "" : String(o.price_high),
      }))
    );
  };

  const setOverride = (index: number, patch: Partial<OverrideForm>) => {
    setOverrideForms((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...patch } : f))
    );
  };

  // Kosong = ikut harga varian (null); terisi WAJIB angka ≥ 0 — jangan
  // diam-diam jadi 0 karena 0 adalah harga comp yang sah (hasil review)
  const parsePrice = (raw: string): number | null | "invalid" => {
    if (raw.trim() === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : "invalid";
  };

  const hasInvalidPrice = overrideForms.some(
    (f) =>
      parsePrice(f.price_regular) === "invalid" ||
      parsePrice(f.price_high) === "invalid"
  );

  const handleSavePrices = () => {
    if (!priceDialog || savePricesMutation.isPending || hasInvalidPrice) return;
    savePricesMutation.mutate({
      id: priceDialog.product.id,
      values: {
        channel_id: priceDialog.channel.channel_id,
        prices: overrideForms.map((f) => ({
          variant_id: f.variant_id,
          price_regular: parsePrice(f.price_regular) as number | null,
          price_high: parsePrice(f.price_high) as number | null,
        })),
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Channel Manager</h1>
        <p className="mt-1 text-sm text-gray-500">
          Distribusikan tiap ticket ke kanal penjualan — POS (loket walk-in)
          dan Website Booking — plus harga khusus per kanal bila perlu.
        </p>
      </div>

      <PurchasingListSection
        icon={GlobeAltIcon}
        title="Distribusi Ticket per Kanal"
        description="Hanya ticket Active ber-harga lengkap yang bisa dinyalakan. Harga kanal kosong = ikut harga varian."
        toolbar={
          <Button size="sm" variant="outline" asChild>
            <Link href="/dashboard/ticketing/tickets">Kelola Master Ticket</Link>
          </Button>
        }
      >
        {boardQuery.isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
            <p className="mt-2 text-sm text-gray-500">Memuat channel manager...</p>
          </div>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                  <th className="px-4 py-3 text-left font-semibold">Ticket</th>
                  {items[0]?.channels.map((channel) => (
                    <th
                      key={channel.channel_id}
                      className="px-4 py-3 text-center font-semibold"
                    >
                      {channel.channel_code === "walk-in" ? "POS (Walk-in)" : "Website Booking"}
                    </th>
                  ))}
                </TableRow>
              </thead>
              <tbody className="divide-y divide-gray-200/50">
                {items.map((product) => (
                  <TableRow key={product.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {product.thumbnail_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={product.thumbnail_url}
                            alt=""
                            className="h-10 w-10 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                            <TicketIcon className="h-5 w-5 text-gray-400" />
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-gray-900">{product.name}</p>
                          <p className="font-mono text-xs text-gray-500">
                            {product.code}
                            {product.status === "draft" ? (
                              <Badge className="ml-2 border-0 bg-gray-100 font-normal text-gray-500">
                                Draft
                              </Badge>
                            ) : null}
                          </p>
                        </div>
                      </div>
                    </td>
                    {product.channels.map((channel) => {
                      // Alasan blokir dihitung TERLEPAS dari status toggle —
                      // papan jangan memperlihatkan "menyala" utk ticket Draft
                      const blockReason =
                        product.status !== "active"
                          ? "Ticket masih Draft"
                          : !channel.price_complete
                            ? "Harga belum lengkap"
                            : null;
                      const blocked = blockReason !== null && !channel.is_distributed;
                      return (
                        <td key={channel.channel_id} className="px-4 py-3">
                          <div className="flex flex-col items-center gap-1.5">
                            <Switch
                              checked={channel.is_distributed}
                              disabled={toggleMutation.isPending || blocked}
                              onCheckedChange={(checked) =>
                                toggleMutation.mutate({
                                  id: product.id,
                                  values: {
                                    channel_id: channel.channel_id,
                                    is_distributed: checked,
                                  },
                                })
                              }
                            />
                            {blockReason ? (
                              <p className="max-w-40 text-center text-xs text-amber-600">
                                {blockReason}
                              </p>
                            ) : (
                              <button
                                type="button"
                                className="text-xs text-gray-400 underline-offset-2 hover:text-pink-600 hover:underline"
                                onClick={() => openPriceDialog(product, channel)}
                              >
                                Harga kanal
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </TableRow>
                ))}
                {items.length === 0 ? (
                  <TableRow>
                    <td
                      colSpan={1 + (items[0]?.channels.length ?? 2)}
                      className="px-4 py-10 text-center text-sm text-gray-500"
                    >
                      Belum ada ticket — buat dulu di Master Ticket.
                    </td>
                  </TableRow>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      <Dialog
        open={priceDialog !== null}
        onOpenChange={(open) => !open && setPriceDialog(null)}
      >
        <DialogPanel size="lg">
          <DialogPanelHeader>
            <DialogPanelTitle>
              {priceDialog
                ? `Harga ${priceDialog.channel.channel_code === "walk-in" ? "POS" : "Website"} — ${priceDialog.product.name}`
                : "Harga Kanal"}
            </DialogPanelTitle>
            <DialogPanelDescription>
              Kosongkan untuk mengikuti harga varian. Terisi = harga khusus
              kanal ini (menang atas harga varian).
            </DialogPanelDescription>
          </DialogPanelHeader>
          {priceDialog ? (
            <DialogPanelBody className="space-y-3">
              {hasInvalidPrice ? (
                <p className="text-xs text-red-600">
                  Ada harga tidak valid — isi angka ≥ 0 atau kosongkan.
                </p>
              ) : null}
              <div className="overflow-hidden rounded-lg border border-gray-200/70">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500">
                      <th className="px-3 py-2 text-left font-semibold">Varian</th>
                      <th className="px-3 py-2 text-left font-semibold">Regular</th>
                      <th className="px-3 py-2 text-left font-semibold">High Season</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200/50">
                    {priceDialog.product.variants.map((variant, index) => {
                      const form = overrideForms[index];
                      if (!form) return null;
                      return (
                        <tr key={variant.id}>
                          <td className="px-3 py-2">
                            <p className="font-medium text-gray-900">{variant.name}</p>
                            <p className="text-xs text-gray-400">
                              varian:{" "}
                              {variant.price_regular === null
                                ? "—"
                                : formatRupiah(variant.price_regular)}{" "}
                              /{" "}
                              {variant.price_high === null
                                ? "—"
                                : formatRupiah(variant.price_high)}
                            </p>
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              min={0}
                              step={5000}
                              placeholder="ikut varian"
                              value={form.price_regular}
                              onChange={(e) =>
                                setOverride(index, { price_regular: e.target.value })
                              }
                              className="h-9"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              min={0}
                              step={5000}
                              placeholder="ikut varian"
                              value={form.price_high}
                              onChange={(e) =>
                                setOverride(index, { price_high: e.target.value })
                              }
                              className="h-9"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </DialogPanelBody>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPriceDialog(null)}>
              Batal
            </Button>
            <Button
              onClick={handleSavePrices}
              disabled={savePricesMutation.isPending || hasInvalidPrice}
            >
              {savePricesMutation.isPending ? "Menyimpan…" : "Simpan Harga Kanal"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
