"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle, Loader2, MessageCircle, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { printThermalReceipt } from "@/components/pos/PrintReceipt";
import { sendReceiptWa } from "../api";
import type { CashierSessionState } from "../cashier-session";

type ReceiptResult = NonNullable<CashierSessionState["result"]>;

function Row(props: { label: string; children: React.ReactNode; valueClassName?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{props.label}</span>
      <span className={props.valueClassName ?? "font-semibold tabular-nums text-foreground"}>
        {props.children}
      </span>
    </div>
  );
}

/**
 * Isi dialog struk. Dipasang ulang per transaksi, jadi state cetak & WA
 * otomatis bersih. Member ber-nomor: field WA sudah terisi dan bisa diganti.
 */
function ReceiptResultPanel(props: {
  result: ReceiptResult;
  formatCurrency: (value: number) => string;
  onClose: () => void;
}) {
  const { payload, kind } = props.result;
  const { formatCurrency } = props;
  const [printing, setPrinting] = useState(false);
  const [phone, setPhone] = useState(props.result.waPhone);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offlined = kind === "offlined";

  const print = async (label: "KITCHEN" | "BAR" | "CUSTOMER") => {
    if (printing) return;
    setPrinting(true);
    try {
      await printThermalReceipt(payload, label);
    } finally {
      setPrinting(false);
    }
  };

  const sendWa = async () => {
    if (!payload.orderId) {
      setError("Order offline belum tersinkron — kirim WA setelah online.");
      return;
    }
    try {
      setSending(true);
      setError(null);
      const sent = await sendReceiptWa(payload.orderId, phone);
      setSentTo(sent ?? "nomor tujuan");
      toast.success(`Struk terkirim ke ${sent ?? "WA pelanggan"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim WA");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <DialogPanelHeader>
        <DialogPanelTitle>Print Struk</DialogPanelTitle>
        <DialogPanelDescription>
          {offlined
            ? "Order tersimpan offline. Cetak struk bila perlu."
            : "Pembayaran berhasil. Cetak struk untuk pelanggan."}
        </DialogPanelDescription>
      </DialogPanelHeader>
      <DialogPanelBody className="space-y-5">
        {offlined ? (
          <>
            <div className="space-y-2 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-50">
                <AlertCircle className="h-8 w-8 text-amber-600" />
              </div>
              <h2 className="text-xl font-bold text-foreground">Saved offline</h2>
              <p className="text-sm text-muted-foreground">Order will sync when connection is restored.</p>
            </div>
            <div className="space-y-2.5 rounded-xl border border-amber-200/70 bg-amber-50/60 px-4 py-3.5">
              <Row label="Order">{payload.orderNumber}</Row>
              <Row label="Total">{formatCurrency(payload.total)}</Row>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50">
                <CheckCircle className="h-8 w-8 text-emerald-600" />
              </div>
              <h2 className="text-xl font-bold text-foreground">Payment successful</h2>
              {payload.queueNumber ? (
                <p className="text-4xl font-black tabular-nums text-foreground">{payload.queueNumber}</p>
              ) : null}
              <p className="text-sm text-muted-foreground">
                {payload.queueNumber
                  ? `Nomor Antrian · Order ${payload.orderNumber || ""}`
                  : `Order #${
                      payload.orderNumber?.slice(-8).toUpperCase() ||
                      payload.orderId?.slice(-8).toUpperCase()
                    }`}
              </p>
            </div>
            <div className="space-y-2.5 rounded-xl border border-gray-200/70 bg-muted/30 px-4 py-3.5">
              <Row label="Amount paid">{formatCurrency(payload.total)}</Row>
              {payload.change > 0 ? (
                <Row label="Change" valueClassName="font-semibold tabular-nums text-emerald-600">
                  {formatCurrency(payload.change)}
                </Row>
              ) : null}
              {payload.paymentMethod ? (
                <Row label="Method" valueClassName="font-medium capitalize text-foreground">
                  {payload.paymentMethod.replace("_", " ")}
                </Row>
              ) : null}
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["KITCHEN", "Kitchen"],
              ["BAR", "Bar"],
            ] as const
          ).map(([label, text]) => (
            <Button
              key={label}
              type="button"
              variant="outline"
              onClick={() => void print(label)}
              disabled={printing}
              className="h-auto flex-col gap-1 border-gray-200/80 px-2 py-2.5 text-xs font-semibold text-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-brand-text"
            >
              <Printer className="h-4 w-4" />
              {text}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          onClick={() => void print("CUSTOMER")}
          disabled={printing}
          className="h-11 w-full gap-2 bg-primary hover:bg-primary/90"
        >
          {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
          Print Struk
        </Button>

        {sentTo ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/60 px-4 py-2.5 text-sm text-emerald-700">
            <CheckCircle className="h-4 w-4" />
            Struk terkirim ke {sentTo}
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <Input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setError(null);
                }}
                placeholder="Nomor WA pelanggan (08…)"
                className="h-11"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void sendWa()}
                disabled={sending || !phone.trim()}
                className="h-11 shrink-0 gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                Kirim WA
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {props.result.waPhone
                ? "Nomor pelanggan — bisa diganti sebelum kirim"
                : "Isi nomor WA pelanggan, atau biarkan kosong jika tidak dikirim"}
            </p>
          </div>
        )}
        {error && <p className="text-center text-xs text-red-600">{error}</p>}
      </DialogPanelBody>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={props.onClose} className="w-full border-gray-200/80 sm:w-auto">
          Transaksi baru
        </Button>
      </DialogFooter>
    </>
  );
}

export function ReceiptResultDialog(props: {
  result: ReceiptResult | null;
  formatCurrency: (value: number) => string;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(props.result)} onOpenChange={(open) => !open && props.onClose()}>
      <DialogPanel size="sm" showCloseButton={false}>
        {props.result ? (
          <ReceiptResultPanel result={props.result} formatCurrency={props.formatCurrency} onClose={props.onClose} />
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}
