'use client';

import { useState } from 'react';
import { Lock, Unlock, Loader2, Banknote, Printer, Receipt, Clock } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatNumber, formatRupiah, formatTime } from '@/lib/format';
import type { PosShift } from '@/lib/pos-api';

interface ShiftSummary {
  total_orders?: number;
  total_sales?: number;
  total_refunds?: number;
  opening_cash?: number;
  expected_cash?: number;
  closing_cash?: number;
  variance?: number;
  /** Penjualan paket gym front desk yang ikut shift ini. */
  gym_sales?: { sales: number; count: number };
}

interface ShiftModalProps {
  open: boolean;
  shift: PosShift | null;
  onClose: () => void;
  onOpenShift: (openingCash: number, notes?: string) => Promise<{ success?: boolean; error?: string }>;
  onCloseShift: (closingCash: number, notes?: string) => Promise<{
    success?: boolean;
    error?: string;
    summary?: ShiftSummary;
  }>;
  /** @deprecated Tidak dipakai lagi (format rupiah bersama) — tetap ada demi kompatibilitas */
  formatCurrency?: (n: number) => string;
  /** false: Cetak hanya mencetak (laporan WA lewat route POS, butuh akses POS). */
  sendReport?: boolean;
}

const formatMoney = formatRupiah;
const formatShiftTime = (value?: string | null) => formatTime(value, '—');

function parseCashInput(value: string) {
  return parseInt(value.replace(/\D/g, '') || '0', 10);
}

function formatCashInputDisplay(raw: string) {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const num = Number.parseInt(digits, 10);
  if (!Number.isFinite(num)) return '';
  return formatNumber(num);
}

function hasCashInput(value: string) {
  return value.replace(/\D/g, '').length > 0;
}

/** Isi modal di-mount ulang tiap dibuka atau saat shift berganti → form selalu bersih. */
export function ShiftModal(props: ShiftModalProps) {
  if (!props.open) return null;
  return <ShiftModalBody key={props.shift?.id ?? 'no-shift'} {...props} />;
}

function ShiftModalBody({ shift, onClose, onOpenShift, onCloseShift, sendReport = true }: ShiftModalProps) {
  const [view, setView] = useState<'open' | 'close' | 'summary'>(shift ? 'close' : 'open');
  const [openingCash, setOpeningCash] = useState('');
  const [closingCash, setClosingCash] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  /* Laporan tutup kasir via WA (dipicu tombol Cetak — keputusan owner: print
   * dulu, WA menyusul otomatis ke nomor-nomor di Settings). shift prop bisa
   * sudah di-null-kan parent setelah close, jadi id-nya ditangkap saat close. */
  const [closedShiftId, setClosedShiftId] = useState<string | null>(null);
  const [sendingReport, setSendingReport] = useState(false);
  const [reportSent, setReportSent] = useState(false);

  // Modal di-unmount saat ditutup, jadi state form ikut bersih.
  const handleDismiss = onClose;

  const handleOpen = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseCashInput(openingCash);
    if (val < 0) return;

    setBusy(true);
    try {
      const res = await onOpenShift(val, notes.trim() || undefined);
      if (res.success) {
        toast.success('Shift dibuka');
        handleDismiss();
      } else {
        toast.error(res.error || 'Gagal membuka shift');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseCashInput(closingCash);
    if (val < 0) return;

    setBusy(true);
    try {
      const res = await onCloseShift(val, notes.trim() || undefined);
      if (res.success) {
        setClosedShiftId(shift?.id ?? null);
        setReportSent(false);
        setSummary(res.summary ?? null);
        setView('summary');
        toast.success('Shift ditutup');
      } else {
        toast.error(res.error || 'Gagal menutup shift');
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePrintReport = async () => {
    if (!summary) return;

    // Cetak lewat jendela kecil berisi ringkasan — tidak bergantung printer
    // thermal; di tablet Android jendela ini juga bisa diarahkan ke RawBT.
    const w = window.open("", "_blank", "width=320,height=480");
    if (w) {
      const baris = (label: string, value: string) =>
        `<tr><td style="padding:2px 8px 2px 0">${label}</td><td style="text-align:right;font-weight:600">${value}</td></tr>`;
      w.document.write(
        `<html><head><title>Laporan Tutup Kasir</title></head><body style="font-family:monospace;font-size:12px">` +
          `<h3 style="margin:0 0 8px">Laporan Tutup Kasir</h3><table>` +
          baris("Transaksi", String(summary.total_orders ?? 0)) +
          baris("Total penjualan", formatMoney(summary.total_sales ?? 0)) +
          (summary.gym_sales?.count ? baris("Penjualan gym", formatMoney(summary.gym_sales.sales)) : "") +
          (summary.total_refunds ? baris("Refund", formatMoney(summary.total_refunds)) : "") +
          baris("Kas awal", formatMoney(summary.opening_cash ?? 0)) +
          baris("Kas seharusnya", formatMoney(summary.expected_cash ?? 0)) +
          baris("Kas fisik", formatMoney(summary.closing_cash ?? 0)) +
          baris("Selisih", formatMoney(summary.variance ?? 0)) +
          `</table></body></html>`
      );
      w.document.close();
      w.focus();
      w.print();
    }

    // Setelah print dipicu → laporan WA menyusul otomatis, sekali saja.
    if (!sendReport || reportSent || !closedShiftId) return;
    try {
      setSendingReport(true);
      const res = await fetch(`/api/pos/shifts/${closedShiftId}/send-report`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Gagal mengirim laporan WA");
      setReportSent(true);
      toast.success(
        `Laporan terkirim via WA ke ${json.data?.terkirim ?? 0} dari ${json.data?.total ?? 0} nomor`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengirim laporan WA");
    } finally {
      setSendingReport(false);
    }
  };

  const isSummary = view === 'summary' && summary;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) handleDismiss(); }}>
      <DialogPanel size={isSummary ? 'sm' : 'md'}>
        {isSummary ? (
          <>
            <DialogPanelHeader>
              <DialogPanelTitle>Ringkasan shift</DialogPanelTitle>
              <DialogPanelDescription>Periksa total penutupan sebelum selesai.</DialogPanelDescription>
            </DialogPanelHeader>
            <DialogPanelBody className="space-y-4">
              <div className="rounded-xl border border-gray-200/70 bg-gray-50/80 p-4 text-sm shadow-xs">
                <SummaryRow label="Transaksi" value={String(summary.total_orders ?? 0)} />
                <SummaryRow label="Total penjualan" value={formatMoney(summary.total_sales ?? 0)} bold />
                {summary.gym_sales?.count ? (
                  <SummaryRow label="Penjualan gym" value={formatMoney(summary.gym_sales.sales)} />
                ) : null}
                {summary.total_refunds ? <SummaryRow label="Refund" value={formatMoney(summary.total_refunds)} /> : null}
                <SummaryRow label="Kas awal" value={formatMoney(summary.opening_cash ?? 0)} />
                <SummaryRow label="Kas seharusnya" value={formatMoney(summary.expected_cash ?? 0)} />
                <SummaryRow label="Kas fisik" value={formatMoney(summary.closing_cash ?? 0)} />
                <SummaryRow
                  label="Selisih"
                  value={formatMoney(summary.variance ?? 0)}
                  bold
                  valueClassName={
                    summary.variance !== 0 ? 'text-red-600' : 'text-green-600'
                  }
                />
              </div>
            </DialogPanelBody>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={sendingReport}
                onClick={() => void handlePrintReport()}
                className="gap-2"
              >
                {sendingReport ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Printer className="h-4 w-4" />
                )}
                {!sendReport ? "Cetak" : reportSent ? "Cetak lagi" : "Cetak & Kirim WA"}
              </Button>
              <Button
                type="button"
                onClick={handleDismiss}
                className="bg-primary hover:bg-primary/90"
              >
                Selesai
              </Button>
            </DialogFooter>
          </>
        ) : shift ? (
          <DialogPanelForm onSubmit={handleClose}>
            <DialogPanelHeader>
              <DialogPanelTitle className="flex items-center gap-2">
                <Unlock className="h-4 w-4 text-green-600" />
                Tutup shift
              </DialogPanelTitle>
              <DialogPanelDescription>
                Hitung uang fisik di laci lalu tutup shift yang aktif.
              </DialogPanelDescription>
            </DialogPanelHeader>
            <DialogPanelBody className="space-y-4">
              <div className="rounded-xl border border-green-200/70 bg-green-50/60 p-4 text-sm shadow-xs">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold uppercase tracking-wide text-green-800">
                    {shift.shift_number}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-green-700">
                    <Clock className="h-3.5 w-3.5" />
                    {formatShiftTime(shift.opened_at)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <StatCard
                    icon={Banknote}
                    label="Kas awal"
                    value={formatMoney(shift.opening_cash)}
                  />
                  <StatCard
                    icon={Receipt}
                    label="Transaksi"
                    value={String(shift.total_orders ?? 0)}
                  />
                </div>
                <div className="mt-3 border-t border-green-200/70 pt-3">
                  <p className="text-xs text-green-700">Total penjualan</p>
                  <p className="text-lg font-bold text-green-900">{formatMoney(shift.total_sales ?? 0)}</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="closing-cash" className="text-xs font-medium text-gray-700">
                  Kas fisik <span className="text-red-500">*</span>
                </label>
                <Input
                  id="closing-cash"
                  type="text"
                  inputMode="numeric"
                  placeholder="500.000"
                  value={closingCash}
                  onChange={(e) => setClosingCash(formatCashInputDisplay(e.target.value))}
                  className="h-9 text-sm focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
                  disabled={busy}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="close-notes" className="text-xs font-medium text-gray-700">
                  Catatan
                </label>
                <Input
                  id="close-notes"
                  placeholder="Catatan penutupan (opsional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="h-9 text-sm focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
                  disabled={busy}
                />
              </div>
            </DialogPanelBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleDismiss} disabled={busy}>
                Batal
              </Button>
              <Button
                type="submit"
                variant="outline"
                disabled={busy || !hasCashInput(closingCash)}
                className="border-red-200/80 text-red-600 hover:bg-red-50"
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Menutup…
                  </>
                ) : (
                  'Tutup shift'
                )}
              </Button>
            </DialogFooter>
          </DialogPanelForm>
        ) : (
          <DialogPanelForm onSubmit={handleOpen}>
            <DialogPanelHeader>
              <DialogPanelTitle className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-brand-text" />
                Buka shift
              </DialogPanelTitle>
              <DialogPanelDescription>
                Mulai shift kasir baru sebelum menerima transaksi.
              </DialogPanelDescription>
            </DialogPanelHeader>
            <DialogPanelBody className="space-y-4">
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
                Belum ada shift aktif. Buka shift untuk menerima order dan pembayaran.
              </div>

              <div className="space-y-1.5">
                <label htmlFor="opening-cash" className="text-xs font-medium text-gray-700">
                  Kas awal <span className="text-red-500">*</span>
                </label>
                <Input
                  id="opening-cash"
                  type="text"
                  inputMode="numeric"
                  placeholder="500.000"
                  value={openingCash}
                  onChange={(e) => setOpeningCash(formatCashInputDisplay(e.target.value))}
                  className="h-9 text-sm focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
                  disabled={busy}
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="open-notes" className="text-xs font-medium text-gray-700">
                  Catatan
                </label>
                <Input
                  id="open-notes"
                  placeholder="Catatan shift (opsional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="h-9 text-sm focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
                  disabled={busy}
                />
              </div>
            </DialogPanelBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleDismiss} disabled={busy}>
                Batal
              </Button>
              <Button
                type="submit"
                disabled={busy || !hasCashInput(openingCash)}
                className="bg-primary hover:bg-primary/90"
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Membuka…
                  </>
                ) : (
                  'Buka shift'
                )}
              </Button>
            </DialogFooter>
          </DialogPanelForm>
        )}
      </DialogPanel>
    </Dialog>
  );
}

function SummaryRow({
  label,
  value,
  bold,
  valueClassName,
}: {
  label: string;
  value: string;
  bold?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-gray-500">{label}</span>
      <span className={bold ? `font-semibold text-gray-900 ${valueClassName ?? ''}` : `text-gray-900 ${valueClassName ?? ''}`}>
        {value}
      </span>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Banknote;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-green-200/60 bg-white/70 px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-green-700">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}
