"use client";

// Dialog aksi gift card: reload saldo, tautkan member (cari per nomor HP),
// dan cetak kartu ber-QR. Nilai QR = kode kartu, sehingga scanner di kasir
// cukup "mengetik" kode ke kolom gift card.

import { useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, Printer, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GIFT_CARD_RELOAD_PAYMENT_METHODS } from "@/lib/giftcard/reload-payment-methods";
import { lookupMembersByPhone } from "../gift-card-api";
import { useLinkGiftCardMember, useReloadGiftCard } from "../gift-card-queries";
import type { GiftCard } from "../gift-card-types";
import { formatRupiah } from "@/lib/format";


type DialogProps = { card: GiftCard | null; onClose: () => void };

export function GiftCardReloadDialog({ card, onClose }: DialogProps) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("cash");
  const [reference, setReference] = useState("");
  const close = () => {
    setAmount("");
    setReference("");
    onClose();
  };
  const reload = useReloadGiftCard(close);
  const amountNum = Number(amount.replace(/\D/g, ""));
  const valid = Number.isInteger(amountNum) && amountNum > 0;

  return (
    <Dialog open={Boolean(card)} onOpenChange={(open) => !open && !reload.isPending && close()}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle>Reload saldo</DialogPanelTitle>
          <DialogPanelDescription>
            Kartu <span className="font-mono">{card?.code}</span> · saldo{" "}
            {formatRupiah(card?.balance ?? 0)}. Pembayaran tercatat di riwayat kartu.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="gc-reload-amount">Nominal (Rp)</Label>
            <Input
              id="gc-reload-amount"
              inputMode="numeric"
              placeholder="100000"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Metode bayar</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(GIFT_CARD_RELOAD_PAYMENT_METHODS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="gc-reload-ref">Referensi pembayaran (opsional)</Label>
            <Input
              id="gc-reload-ref"
              placeholder="No. struk EDC / transfer"
              value={reference}
              maxLength={80}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
        </DialogPanelBody>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={reload.isPending}>
            Batal
          </Button>
          <Button
            disabled={!valid || reload.isPending}
            onClick={() =>
              card &&
              reload.mutate({
                id: card.id,
                values: {
                  amount: amountNum,
                  payment_method: method,
                  payment_reference: reference.trim() || null,
                },
              })
            }
          >
            {reload.isPending ? "Menyimpan…" : valid ? `Reload ${formatRupiah(amountNum)}` : "Reload"}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}

export function GiftCardMemberDialog({ card, onClose }: DialogProps) {
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState("");
  const close = () => {
    setPhone("");
    setSubmitted("");
    onClose();
  };
  const link = useLinkGiftCardMember(close);
  const members = useQuery({
    queryKey: ["giftcard", "member-lookup", submitted],
    queryFn: () => lookupMembersByPhone(submitted),
    enabled: submitted.length >= 6,
  });

  return (
    <Dialog open={Boolean(card)} onOpenChange={(open) => !open && !link.isPending && close()}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle>Tautkan ke member</DialogPanelTitle>
          <DialogPanelDescription>
            {card?.customer_name
              ? `Saat ini milik ${card.customer_name}. Pilih member lain atau lepas tautan.`
              : "Kartu tertaut tampil di detail member CRM."}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(phone.replace(/\D/g, ""));
            }}
          >
            <Input
              inputMode="tel"
              placeholder="Nomor HP member, mis. 0812…"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <Button type="submit" variant="outline" disabled={phone.replace(/\D/g, "").length < 6}>
              <Search className="mr-1.5 h-4 w-4" />
              Cari
            </Button>
          </form>
          {members.isFetching ? (
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          ) : submitted && (members.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Tidak ada member dengan nomor itu.</p>
          ) : (
            <ul className="space-y-2">
              {(members.data ?? []).map((member) => (
                <li
                  key={member.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{member.name ?? "Tanpa nama"}</p>
                    <p className="text-xs text-muted-foreground">{member.phone}</p>
                  </div>
                  <Button
                    size="sm"
                    disabled={link.isPending || member.id === card?.customer_id}
                    onClick={() => card && link.mutate({ id: card.id, customerId: member.id })}
                  >
                    {member.id === card?.customer_id ? "Tertaut" : "Tautkan"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogPanelBody>
        <DialogFooter>
          {card?.customer_id ? (
            <Button
              variant="outline"
              disabled={link.isPending}
              onClick={() => link.mutate({ id: card.id, customerId: null })}
            >
              Lepas tautan
            </Button>
          ) : null}
          <Button variant="outline" onClick={close} disabled={link.isPending}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}

export function GiftCardPrintDialog({ card, onClose }: DialogProps) {
  const qrRef = useRef<HTMLDivElement>(null);

  const print = () => {
    if (!card || !qrRef.current) return;
    const popup = window.open("", "_blank", "width=420,height=560");
    if (!popup) return;
    const doc = popup.document;
    doc.title = `Gift Card ${card.code}`;
    const style = doc.createElement("style");
    style.textContent =
      "body{font-family:sans-serif;text-align:center;padding:24px}" +
      ".code{font-family:monospace;font-size:20px;letter-spacing:2px;margin-top:12px}" +
      ".value{font-size:14px;color:#555;margin-top:4px}";
    doc.head.appendChild(style);
    const heading = doc.createElement("h2");
    heading.textContent = "Gift Card";
    const qr = doc.createElement("div");
    qr.innerHTML = qrRef.current.innerHTML;
    const code = doc.createElement("div");
    code.className = "code";
    code.textContent = card.code;
    const value = doc.createElement("div");
    value.className = "value";
    value.textContent = `Saldo ${formatRupiah(card.balance)}`;
    doc.body.append(heading, qr, code, value);
    popup.focus();
    popup.print();
  };

  return (
    <Dialog open={Boolean(card)} onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>QR gift card</DialogPanelTitle>
          <DialogPanelDescription>
            Scan QR ini di kolom gift card kasir untuk bayar atau reload.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="flex flex-col items-center gap-3">
          <div ref={qrRef} className="rounded-xl bg-white p-3">
            {card ? <QRCodeSVG value={card.code} size={200} marginSize={2} /> : null}
          </div>
          <p className="font-mono text-lg tracking-widest">{card?.code}</p>
        </DialogPanelBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Tutup
          </Button>
          <Button onClick={print}>
            <Printer className="mr-1.5 h-4 w-4" />
            Cetak
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
