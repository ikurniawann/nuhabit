"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Paperclip, Pencil, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RupiahInput } from "@/features/sales-funnel/pipeline/components/rupiah-input";
import {
  useDeleteFakturPajak,
  useInvoiceDetail,
  useInvoicePayments,
  useReviseInvoice,
  useUploadFakturPajak,
} from "../queries";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";

const FAKTUR_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
const FAKTUR_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Detail invoice untuk Finance: acuan quotation/termin jelas + riwayat
 * pembayaran, dengan mode Revisi (label/nominal/jatuh tempo/catatan).
 * Revisi ditutup begitu invoice batal atau sudah menerima pembayaran —
 * guard yang sama berlaku di server (PATCH /api/finance/invoices/[id]).
 */

const STATUS_BADGES: Record<string, string> = {
  diajukan: "bg-amber-100 text-amber-700",
  draft: "bg-gray-100 text-gray-600",
  terkirim: "bg-blue-100 text-blue-700",
  batal: "bg-red-100 text-red-600",
};

const PAYMENT_BADGES: Record<string, string> = {
  lunas: "bg-emerald-100 text-emerald-700",
  sebagian: "bg-amber-100 text-amber-700",
  belum: "bg-gray-100 text-gray-500",
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Tunai",
  transfer: "Transfer",
  qris: "QRIS",
  edc: "Kartu / EDC",
  lainnya: "Lainnya",
};


export function InvoiceDetailDialog({
  invoiceId,
  onClose,
}: {
  invoiceId: string | null;
  onClose: () => void;
}) {
  const open = invoiceId !== null;
  const id = invoiceId ?? "";
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const detailQuery = useInvoiceDetail(id, open);
  const paymentsQuery = useInvoicePayments(id, open);
  const reviseMutation = useReviseInvoice(() => setEditing(false));
  const uploadFakturMutation = useUploadFakturPajak();
  const deleteFakturMutation = useDeleteFakturPajak();

  const detail = detailQuery.data;
  const payments = paymentsQuery.data ?? [];
  const canRevise = Boolean(detail && detail.status !== "batal" && detail.paid === 0);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setEditing(false);
      onClose();
    }
  };

  const startEdit = () => {
    if (!detail) return;
    setLabel(detail.label);
    setAmount(String(Math.round(detail.amount)));
    setDueDate(detail.due_date ?? "");
    setNote(detail.note ?? "");
    setEditing(true);
  };

  const handleSave = () => {
    const value = Number(amount) || 0;
    if (!label.trim() || value <= 0 || reviseMutation.isPending) return;
    reviseMutation.mutate({
      invoiceId: id,
      values: {
        label: label.trim(),
        amount: value,
        due_date: dueDate || null,
        note: note.trim() || null,
      },
    });
  };

  const handleFakturFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset agar file yang sama bisa dipilih ulang
    if (!file) return;
    if (file.size > FAKTUR_MAX_BYTES) {
      toast.error("Ukuran dokumen maksimal 10 MB");
      return;
    }
    uploadFakturMutation.mutate({ invoiceId: id, file });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPanel size="md">
        {!detail ? (
          <DialogPanelBody>
            <div className="py-10 text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-pink-600" />
            </div>
          </DialogPanelBody>
        ) : (
          <>
            <DialogPanelHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <DialogPanelTitle>{detail.invoice_number}</DialogPanelTitle>
                <p className="mt-0.5 text-sm text-gray-500">
                  {detail.org_name} · {detail.deal_title}
                </p>
              </div>
              {!editing && canRevise ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={startEdit}
                  className="h-8 shrink-0 gap-1.5 rounded-lg"
                >
                  <Pencil className="h-3.5 w-3.5" /> Revisi
                </Button>
              ) : null}
            </DialogPanelHeader>
            <DialogPanelBody className="space-y-4">
              <div className="flex items-center gap-1.5">
                <Badge className={`border-0 font-normal ${STATUS_BADGES[detail.status]}`}>
                  {detail.status}
                </Badge>
                {detail.status !== "batal" ? (
                  <Badge
                    className={`border-0 font-normal ${PAYMENT_BADGES[detail.payment_status]}`}
                  >
                    {detail.payment_status}
                  </Badge>
                ) : null}
                {!canRevise && detail.status !== "batal" ? (
                  <span className="text-xs text-gray-400">
                    sudah menerima pembayaran — tidak bisa direvisi
                  </span>
                ) : null}
              </div>

              {/* ── Acuan quotation — jawab "invoice ini refer ke quotation mana" ── */}
              <div className="rounded-xl border border-gray-200/80 bg-gray-50/60 p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Mengacu ke Quotation
                </p>
                {detail.quotation ? (
                  <>
                    <p className="mt-1 font-medium text-gray-900">
                      {detail.quotation.quote_number}
                      <span className="ml-1.5 font-normal text-gray-500">
                        ({detail.quotation.status}
                        {detail.quotation.use_ppn
                          ? ` · PPN ${detail.quotation.ppn_persen}%`
                          : " · tanpa PPN"}
                        )
                      </span>
                    </p>
                    <p className="text-xs text-gray-500">
                      Total quotation {formatRupiah(detail.quotation.total)}
                    </p>
                    {detail.term ? (
                      <p className="mt-1 text-xs text-gray-600">
                        Termin: {detail.term.label} (
                        {formatNumber(detail.term.percent, 2)}%)
                        {detail.term.due_date
                          ? ` · jatuh tempo asal ${formatDate(detail.term.due_date, "—")}`
                          : ""}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-gray-500">
                        Diajukan tanpa termin spesifik.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-sm text-gray-600">
                    Nominal bebas — tidak mengacu ke termin quotation manapun.
                  </p>
                )}
              </div>

              {/* ── Lampiran Faktur Pajak — dokumen pajak resmi, terpisah dari PDF invoice internal ── */}
              <div className="rounded-xl border border-gray-200/80 p-3 text-sm">
                <p className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  <Paperclip className="h-3.5 w-3.5" /> Faktur Pajak
                </p>
                {detail.has_faktur_pajak ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={`/api/finance/invoices/${detail.id}/faktur-pajak`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-pink-600 hover:underline"
                    >
                      <FileText className="h-4 w-4" /> Lihat lampiran
                    </a>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadFakturMutation.isPending}
                      className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-40"
                    >
                      Ganti
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteFakturMutation.mutate(detail.id)}
                      disabled={deleteFakturMutation.isPending}
                      title="Hapus lampiran"
                      className="ml-auto text-gray-300 hover:text-red-500 disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadFakturMutation.isPending}
                    className="h-8 gap-1.5 rounded-lg"
                  >
                    {uploadFakturMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    Unggah Faktur Pajak
                  </Button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={FAKTUR_ACCEPT}
                  onChange={handleFakturFileChange}
                  className="hidden"
                />
                <p className="mt-1.5 text-xs text-gray-400">
                  PDF/JPG/PNG/WebP, maksimal 10 MB.
                </p>
              </div>

              {editing ? (
                <div className="space-y-2.5">
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-gray-600">Label</p>
                    <Input
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-gray-600">Nominal</p>
                      <RupiahInput
                        value={amount}
                        onValueChange={setAmount}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-gray-600">Jatuh tempo</p>
                      <Input
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        className="h-9 text-sm"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-gray-600">Catatan</p>
                    <Textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      className="text-sm"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                  <div>
                    <p className="text-xs text-gray-400">Label</p>
                    <p className="text-gray-900">{detail.label}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Nominal</p>
                    <p className="font-semibold text-gray-900">
                      {formatRupiah(detail.amount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Jatuh tempo</p>
                    <p className="text-gray-900">{formatDate(detail.due_date, "—")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Tanggal Acara</p>
                    <p className="text-gray-900">{formatDate(detail.event_date, "—")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">PIC</p>
                    <p className="text-gray-900">
                      {detail.pic_name} · {detail.pic_phone}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Diajukan oleh</p>
                    <p className="text-gray-900">{detail.created_by_name ?? "—"}</p>
                  </div>
                  {detail.note ? (
                    <div className="col-span-2">
                      <p className="text-xs text-gray-400">Catatan</p>
                      <p className="whitespace-pre-wrap text-gray-700">{detail.note}</p>
                    </div>
                  ) : null}
                </div>
              )}

              <div>
                <p className="mb-1.5 text-xs font-medium text-gray-600">
                  Riwayat pembayaran
                </p>
                {paymentsQuery.isLoading ? (
                  <div className="py-3 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-pink-600" />
                  </div>
                ) : payments.length === 0 ? (
                  <p className="text-xs text-gray-400">Belum ada pembayaran.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {payments.map((payment) => (
                      <li
                        key={payment.id}
                        className="flex items-center gap-2 rounded-lg border border-gray-200/70 px-3 py-2 text-sm"
                      >
                        <span className="font-semibold text-gray-900">
                          {formatRupiah(payment.amount)}
                        </span>
                        <Badge className="border-0 bg-gray-100 font-normal text-gray-600">
                          {METHOD_LABELS[payment.method] ?? payment.method}
                        </Badge>
                        <span className="text-xs text-gray-500">
                          {formatDate(payment.paid_on, "—")}
                          {payment.note ? ` · ${payment.note}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </DialogPanelBody>
            <DialogFooter>
              {editing ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditing(false)}
                    className="h-9 rounded-lg"
                  >
                    Batal
                  </Button>
                  <Button
                    type="button"
                    onClick={handleSave}
                    disabled={
                      reviseMutation.isPending || !label.trim() || !(Number(amount) > 0)
                    }
                    className="h-9 rounded-lg bg-pink-600 text-white hover:bg-pink-700"
                  >
                    {reviseMutation.isPending ? "Menyimpan…" : "Simpan Revisi"}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="h-9 rounded-lg"
                >
                  Tutup
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogPanel>
    </Dialog>
  );
}
