"use client";

// EPIC-034 Fase B — dialog jual gift card di kasir. Beda dari produk biasa:
// harga TIDAK diambil dari katalog, kasir memilih preset atau mengetik nominal
// bebas (bila diizinkan konfigurasi). Nominal tetap divalidasi ulang di server
// — dialog ini hanya menjaga kasir tidak salah ketik.

import { useEffect, useState } from "react";
import { Gift, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { formatIdrInput, parseIdrDigits } from "./idr-input";

export interface GiftCardSaleValues {
  nominal: number;
  quantity: number;
  buyerName: string | null;
  buyerPhone: string | null;
}

interface Props {
  open: boolean;
  productName: string;
  onClose: () => void;
  onConfirm: (values: GiftCardSaleValues) => void;
  formatCurrency: (v: number) => string;
}

const MAX_QTY = 20;

export function GiftCardSaleDialog({
  open,
  productName,
  onClose,
  onConfirm,
  formatCurrency,
}: Props) {
  const [presets, setPresets] = useState<number[]>([]);
  const [allowCustom, setAllowCustom] = useState(true);
  // Mulai true: dialog selalu mount bersama fetch konfigurasi di bawah
  const [loading, setLoading] = useState(true);
  const [nominal, setNominal] = useState(0);
  const [customInput, setCustomInput] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");

  // Dialog di-mount ulang tiap kali kasir memilih produk gift card (parent
  // merender kondisional), jadi state selalu mulai bersih tanpa efek reset.
  useEffect(() => {
    if (!open) return;
    fetch("/api/pos/gift-card-config")
      .then((res) => res.json())
      .then((body) => {
        const data = body?.data ?? {};
        const list: number[] = Array.isArray(data.presets) ? data.presets : [];
        setPresets(list);
        setAllowCustom(data.allow_custom !== false);
        if (list.length > 0) setNominal(list[0]);
      })
      .catch(() => {
        // Konfigurasi gagal dimuat → kasir masih bisa ketik nominal bebas;
        // server tetap yang memutuskan sah/tidaknya.
        setPresets([]);
        setAllowCustom(true);
      })
      .finally(() => setLoading(false));
  }, [open]);

  const customNominal = parseIdrDigits(customInput);
  const effectiveNominal = customNominal > 0 ? customNominal : nominal;
  const isValid = effectiveNominal > 0 && quantity >= 1 && quantity <= MAX_QTY;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-violet-600" />
            Jual {productName}
          </DialogPanelTitle>
          <DialogPanelDescription>
            Pilih nominal saldo yang diisi ke kartu. Kode kartu tercetak di
            struk setelah pembayaran lunas.
          </DialogPanelDescription>
        </DialogPanelHeader>

        <DialogPanelBody className="space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Memuat pilihan nominal…
            </div>
          ) : (
            <>
              {presets.length > 0 && (
                <div className="space-y-2">
                  <Label>Nominal</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {presets.map((preset) => {
                      const selected =
                        customNominal === 0 && nominal === preset;
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            setNominal(preset);
                            setCustomInput("");
                          }}
                          className={cn(
                            "rounded-xl border px-4 py-3 text-sm font-semibold transition-colors",
                            selected
                              ? "border-violet-400 bg-violet-50 text-violet-700 ring-1 ring-violet-300"
                              : "border-gray-200/70 bg-white hover:border-violet-300 hover:bg-violet-50/50"
                          )}
                        >
                          {formatCurrency(preset)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {allowCustom && (
                <div className="space-y-2">
                  <Label htmlFor="gift-custom">Nominal lain (opsional)</Label>
                  <Input
                    id="gift-custom"
                    inputMode="numeric"
                    placeholder="Ketik nominal bebas"
                    value={customInput}
                    onChange={(e) => setCustomInput(formatIdrInput(e.target.value))}
                    className="h-11"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="gift-qty">Jumlah kartu</Label>
                <Input
                  id="gift-qty"
                  type="number"
                  min={1}
                  max={MAX_QTY}
                  value={quantity}
                  onChange={(e) =>
                    setQuantity(
                      Math.min(MAX_QTY, Math.max(1, Number(e.target.value) || 1))
                    )
                  }
                  className="h-11"
                />
                <p className="text-xs text-muted-foreground">
                  Tiap kartu terbit dengan kode sendiri, nominal sama.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="gift-buyer">Nama pembeli (opsional)</Label>
                  <Input
                    id="gift-buyer"
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gift-phone">WA pembeli (opsional)</Label>
                  <Input
                    id="gift-phone"
                    inputMode="tel"
                    placeholder="08xxxxxxxxxx"
                    value={buyerPhone}
                    onChange={(e) => setBuyerPhone(e.target.value)}
                    className="h-11"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Diisi nomor WA → kode juga dikirim otomatis ke pembeli. Kode
                tetap tercetak di struk.
              </p>

              <div className="flex items-center justify-between rounded-xl border border-violet-200/70 bg-violet-50 px-4 py-3">
                <span className="text-sm font-medium text-violet-800">
                  Total tagihan
                </span>
                <span className="text-lg font-bold text-violet-700">
                  {formatCurrency(effectiveNominal * quantity)}
                </span>
              </div>
            </>
          )}
        </DialogPanelBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button
            type="button"
            disabled={!isValid || loading}
            onClick={() =>
              onConfirm({
                nominal: effectiveNominal,
                quantity,
                buyerName: buyerName.trim() || null,
                buyerPhone: buyerPhone.trim() || null,
              })
            }
          >
            Tambah ke keranjang
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
