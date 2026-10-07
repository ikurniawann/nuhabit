"use client";

import { useMemo, useState } from "react";
import { Camera, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { NumericInput } from "@/components/ui/numeric-input";
import { DsDateTimePicker } from "@/components/design-system";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VendorPayment } from "@/types/purchasing";
import { usePayPurchaseInvoice } from "../mutations";
import type { PurchaseInvoiceRow } from "../types";
import { formatNumber } from "@/lib/format";

type PayDialogProps = {
  row: PurchaseInvoiceRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Form dibangun ulang (key) setiap kali dialog dibuka untuk baris tertentu. */
export function PurchaseInvoicePayDialog(props: PayDialogProps) {
  return <PayDialogBody key={`${props.row?.purchase_order_id ?? ""}:${props.open}`} {...props} />;
}

function PayDialogBody({ row, open, onOpenChange }: PayDialogProps) {
  const payMutation = usePayPurchaseInvoice();
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState<number | undefined>(
    row && row.outstanding_amount > 0 ? row.outstanding_amount : undefined
  );
  const [method, setMethod] = useState<VendorPayment["method"]>("bank_transfer");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  /** Arsip nota hasil scan (EPIC-018 Fase B) — ikut tersimpan di pembayaran. */
  const [receipt, setReceipt] = useState<{ path: string; name: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const outstanding = row?.outstanding_amount ?? 0;
  const paymentPreviewType = useMemo(() => {
    const value = Number(amount || 0);
    if (value <= 0) return null;
    return value >= outstanding - 0.01 ? "full" : "installment";
  }, [amount, outstanding]);

  /**
   * Unggah nota → server mengarsipkan file + membaca isinya (OCR), lalu field
   * tanggal/nomor/jumlah terisi otomatis. Hasil baca HANYA prefill — user awam
   * cukup memeriksa, bukan mengetik ulang; salah baca tinggal dikoreksi.
   */
  const handleScanFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setScanNote({ tone: "warn", text: "File terlalu besar (maksimal 10 MB). Coba foto ulang atau kecilkan filenya." });
      return;
    }

    setScanning(true);
    setScanNote(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/purchasing/receipt-scan", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
        error?: string;
        data?: {
          receipt_path: string;
          receipt_name: string;
          fields: { nomor: string | null; tanggal: string | null; total: number | null };
        };
      };
      if (!res.ok || !json.success || !json.data) {
        setScanNote({ tone: "warn", text: json.error || json.message || "Nota tidak bisa diunggah. Periksa koneksi lalu coba lagi." });
        return;
      }

      setReceipt({ path: json.data.receipt_path, name: json.data.receipt_name });
      const fields = json.data.fields;
      const terisi: string[] = [];
      if (fields.tanggal) {
        setPaymentDate(fields.tanggal);
        terisi.push("tanggal");
      }
      if (fields.nomor) {
        setReferenceNumber(fields.nomor);
        terisi.push("nomor nota");
      }
      let catatanJumlah = "";
      if (fields.total && fields.total > 0) {
        if (fields.total > outstanding + 0.01 && outstanding > 0) {
          setAmount(outstanding);
          catatanJumlah = ` Total di nota (${formatNumber(fields.total)}) lebih besar dari sisa tagihan, jadi jumlah diisi sebesar sisa tagihan.`;
        } else {
          setAmount(fields.total);
        }
        terisi.push("jumlah");
      }

      if (terisi.length > 0) {
        setScanNote({
          tone: "ok",
          text: `Nota terbaca — ${terisi.join(", ")} sudah terisi otomatis.${catatanJumlah} Periksa sekali lagi sebelum menyimpan, ya.`,
        });
      } else {
        setScanNote({
          tone: "warn",
          text: "Nota tersimpan sebagai lampiran, tapi tulisannya belum terbaca jelas. Silakan isi kolom di bawah secara manual — atau coba foto ulang lebih dekat dengan cahaya terang.",
        });
      }
    } catch {
      setScanNote({ tone: "warn", text: "Nota tidak bisa diunggah. Periksa koneksi lalu coba lagi." });
    } finally {
      setScanning(false);
    }
  };

  const handleSubmit = async () => {
    if (!row) return;
    const paymentAmount = Number(amount || 0);
    if (!paymentDate || paymentAmount <= 0) {
      toast.error("Tanggal bayar dan nominal pembayaran wajib diisi");
      return;
    }
    if (paymentAmount > outstanding + 0.01) {
      toast.error(`Nominal pembayaran tidak boleh melebihi sisa tagihan (${formatNumber(outstanding)})`);
      return;
    }

    try {
      await payMutation.mutateAsync({
        poId: row.purchase_order_id,
        payload: {
          payment_date: paymentDate,
          amount: paymentAmount,
          method,
          reference_number: referenceNumber.trim() || null,
          notes: notes.trim() || null,
          receipt_path: receipt?.path ?? null,
          receipt_name: receipt?.name ?? null,
        },
      });
      toast.success(
        paymentPreviewType === "full"
          ? "Pembayaran penuh berhasil dicatat"
          : "Pembayaran berhasil dicatat"
      );
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Gagal mencatat pembayaran");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden rounded-2xl border border-gray-200/70 p-0 shadow-xl ring-1 ring-gray-200/60 sm:max-w-[620px]">
        <DialogHeader className="border-b border-gray-200/70 px-5 py-4">
          <DialogTitle className="text-base font-semibold text-gray-900">
            Bayar {row?.nomor_po || "Purchase Order"}
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-5 text-gray-500">
            Catat pembayaran supplier untuk invoice purchase order ini.
          </DialogDescription>
        </DialogHeader>
        {row && (
          <div className="grid gap-4 px-5 py-4">
            <div className="rounded-xl border border-pink-100 bg-pink-50 p-3">
              <div className="text-xs font-semibold text-pink-700">Sisa Tagihan</div>
              <div className="mt-1 text-lg font-bold text-pink-700">{formatNumber(outstanding)}</div>
              <div className="mt-1 text-xs text-pink-700/80">
                Total PO {formatNumber(row.gross_payable_amount)}
                {row.return_credit_amount > 0 && (
                  <> · Retur -{formatNumber(row.return_credit_amount)}</>
                )}
                {row.reject_credit_amount > 0 && (
                  <> · Nota kredit reject -{formatNumber(row.reject_credit_amount)}</>
                )}
                {" · "}Dibayar {formatNumber(row.paid_amount)}
              </div>
            </div>

            {/* Scan nota (EPIC-018 Fase B): satu tombol besar, bahasa polos,
                hasil baca otomatis selalu bisa dikoreksi manual. */}
            <div>
              {scanning ? (
                <div className="flex items-center gap-3 rounded-xl border border-pink-200 bg-pink-50 px-4 py-3.5">
                  <Loader2 className="size-5 shrink-0 animate-spin text-pink-600" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-800">Sedang membaca nota…</div>
                    <div className="text-xs text-gray-500">Biasanya 5–15 detik. Jangan tutup jendela ini dulu.</div>
                  </div>
                </div>
              ) : receipt ? (
                <div className="flex items-center gap-2.5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                  <FileText className="size-4 shrink-0 text-gray-500" />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-700">{receipt.name}</span>
                  <a
                    href={`/api/purchasing/receipts/${receipt.path
                      .replace(/^purchasing-receipts\//, "")
                      .split("/")
                      .map(encodeURIComponent)
                      .join("/")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-xs font-semibold text-pink-600 hover:underline"
                  >
                    Lihat
                  </a>
                  <label className="shrink-0 cursor-pointer text-xs font-semibold text-pink-600 hover:underline">
                    Ganti
                    <input
                      type="file"
                      className="sr-only"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      onChange={handleScanFile}
                    />
                  </label>
                </div>
              ) : (
                <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-pink-300 bg-pink-50/60 px-4 py-5 text-center transition hover:border-pink-400 hover:bg-pink-50">
                  <input
                    type="file"
                    className="sr-only"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={handleScanFile}
                  />
                  <span className="grid size-10 place-items-center rounded-full bg-pink-100">
                    <Camera className="size-5 text-pink-600" />
                  </span>
                  <span className="text-sm font-semibold text-gray-800">Foto / Unggah Nota</span>
                  <span className="max-w-[340px] text-xs leading-5 text-gray-500">
                    Tanggal, nomor, dan jumlah akan terisi otomatis dari nota. Tidak punya notanya? Isi
                    kolom di bawah seperti biasa.
                  </span>
                </label>
              )}
              {scanNote && (
                <div
                  className={`mt-2 rounded-xl border px-3 py-2 text-xs leading-5 ${
                    scanNote.tone === "ok"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  {scanNote.text}
                </div>
              )}
            </div>

            {paymentPreviewType && (
              <div
                className={`rounded-xl border px-3 py-2 text-sm ${
                  paymentPreviewType === "full"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {paymentPreviewType === "full"
                  ? "Pembayaran ini akan dicatat sebagai Lunas."
                  : "Pembayaran ini akan dicatat sebagai angsuran."}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <DsDateTimePicker
                label="Tanggal Bayar"
                value={paymentDate}
                onChange={setPaymentDate}
                placeholder="Pilih tanggal bayar..."
                dateOnly
                required
              />
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">Nominal Pembayaran</Label>
                  {outstanding > 0 && (
                    <button
                      type="button"
                      className="text-xs font-medium text-pink-600 hover:underline"
                      onClick={() => setAmount(outstanding)}
                    >
                      Bayar seluruh sisa tagihan
                    </button>
                  )}
                </div>
                <NumericInput
                  value={amount}
                  max={outstanding}
                  onValueChange={(value) => setAmount(value || undefined)}
                  decimalScale={0}
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Metode Pembayaran</Label>
                <Combobox
                  options={[
                    { value: "bank_transfer", label: "Transfer Bank" },
                    { value: "cash", label: "Tunai" },
                    { value: "giro", label: "Giro" },
                    { value: "qris", label: "QRIS" },
                    { value: "other", label: "Lainnya" },
                  ]}
                  value={method}
                  onChange={(value) => setMethod(value as VendorPayment["method"])}
                  placeholder="Pilih metode..."
                  searchPlaceholder="Cari metode..."
                  emptyMessage="Metode tidak ditemukan"
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Nomor Referensi</Label>
                <Input
                  value={referenceNumber}
                  onChange={(event) => setReferenceNumber(event.target.value)}
                  placeholder="Nomor transfer / bukti pembayaran"
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Catatan</Label>
              <Input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Opsional"
                className="h-9 text-sm"
              />
            </div>
          </div>
        )}
        <DialogFooter className="mx-0 mb-0 gap-2 border-t border-gray-200/70 bg-gray-50/60 px-5 py-4 sm:justify-end">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={payMutation.isPending || scanning}
            className="purchasing-secondary-button"
          >
            Batal
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={payMutation.isPending || scanning || !row?.can_pay}
            className="purchasing-main-button"
          >
            {payMutation.isPending ? "Memproses..." : "Simpan Pembayaran"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
