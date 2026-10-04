"use client";

import { useState, type ReactNode } from "react";
import { Ban, CheckCircle2, HandCoins, Loader2, Lock, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { CARD_UNLINK_REASONS, CARD_UNLINK_REASON_LABELS, type CardUnlinkReason } from "@/lib/pos/card-unlink";
import type { MemberCardAction } from "../api";
import type { MemberCardRow, RefundRequestRow } from "../types";

type DialogBase = { busy: boolean; onClose: () => void; onSubmit: (action: MemberCardAction) => void };

function ActionDialog({
  title,
  busy,
  onClose,
  wide = true,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className={wide ? "sm:max-w-lg" : "sm:max-w-md"}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

function Footer({
  busy,
  onClose,
  cancelLabel = "Batal",
  children,
}: {
  busy: boolean;
  onClose: () => void;
  cancelLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="outline" disabled={busy} onClick={onClose}>
        {cancelLabel}
      </Button>
      {children}
    </div>
  );
}

const BusyIcon = ({ busy, icon }: { busy: boolean; icon: ReactNode }) =>
  busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{icon}</>;

export function MemberSummary({ member }: { member: MemberCardRow }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
      <div className="flex justify-between">
        <span className="text-gray-500">UID kartu</span>
        <span className="font-mono">{member.nfc_uid}</span>
      </div>
      <div className="mt-1 flex justify-between">
        <span className="text-gray-500">Saldo ARK</span>
        <span className="font-semibold text-emerald-700">{formatRupiah(member.ark_coin_balance)}</span>
      </div>
    </div>
  );
}

/** Lepas kartu (hilang/dikembalikan) tanpa mengubah saldo; alasan "other" wajib keterangan. */
export function UnlinkDialog({ member, busy, onClose, onSubmit }: DialogBase & { member: MemberCardRow }) {
  const [reason, setReason] = useState<CardUnlinkReason | null>(null);
  const [notes, setNotes] = useState("");
  const canConfirm = Boolean(reason) && (reason !== "other" || notes.trim().length >= 3);
  return (
    <ActionDialog title={`Unlink kartu — ${member.name || member.phone}`} busy={busy} onClose={onClose}>
      <MemberSummary member={member} />
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        Saldo & XP member <strong>tidak berubah</strong>. Setelah dilepas, kartu ini tidak bisa dipakai lagi; member bisa
        dipasangkan ke kartu baru kapan saja.
      </p>
      <div>
        <p className="mb-2 text-sm font-semibold text-gray-700">Alasan unlink</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {CARD_UNLINK_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={`min-h-[52px] rounded-xl border-2 px-3 text-sm font-medium transition-colors ${
                reason === r ? "border-primary bg-primary/10 text-brand-text" : "border-gray-200 bg-white text-gray-700 active:bg-gray-50"
              }`}
            >
              {CARD_UNLINK_REASON_LABELS[r]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 text-sm font-semibold text-gray-700">
          Keterangan {reason === "other" ? <span className="text-red-600">(wajib)</span> : "(opsional)"}
        </p>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder={
            reason === "returned"
              ? "mis. kartu dikembalikan ke kasir, member pindah ke aplikasi"
              : reason === "lost"
                ? "mis. dilaporkan hilang tanggal …"
                : "Tuliskan alasannya"
          }
        />
      </div>
      <Footer busy={busy} onClose={onClose}>
        <Button
          className="gap-2 bg-red-600 text-white hover:bg-red-700"
          disabled={!canConfirm || busy}
          onClick={() => reason && onSubmit({ kind: "unlink", memberId: member.id, body: { reason, notes } })}
        >
          <BusyIcon busy={busy} icon={<Unlink className="h-4 w-4" />} />
          Lepas Kartu
        </Button>
      </Footer>
    </ActionDialog>
  );
}

/** Lepas kartu + catat permintaan refund untuk Finance (saldo belum berubah). */
export function RefundDialog({ member, busy, onClose, onSubmit }: DialogBase & { member: MemberCardRow }) {
  const [notes, setNotes] = useState("");
  return (
    <ActionDialog title={`Refund saldo — ${member.name || member.phone}`} busy={busy} onClose={onClose}>
      <MemberSummary member={member} />
      <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <p>
          <strong>1.</strong> Kartu <span className="font-mono">{member.nfc_uid}</span> dilepas sekarang.
        </p>
        <p>
          <strong>2.</strong> Permintaan refund <strong>{formatRupiah(member.ark_coin_balance)}</strong> dicatat untuk Finance —
          saldo member <strong>belum</strong> berubah.
        </p>
        <p>
          <strong>3.</strong> Setelah Finance mengembalikan uangnya, tandai <strong>Refund Completed</strong> (PIN supervisor) di
          daftar permintaan; saldo member menjadi Rp0.
        </p>
      </div>
      <div>
        <p className="mb-1 text-sm font-semibold text-gray-700">Keterangan (opsional)</p>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="mis. rekening tujuan, alasan member berhenti"
        />
      </div>
      <Footer busy={busy} onClose={onClose}>
        <Button
          className="gap-2 bg-amber-600 text-white hover:bg-amber-700"
          disabled={busy}
          onClick={() => onSubmit({ kind: "refund", memberId: member.id, body: { notes } })}
        >
          <BusyIcon busy={busy} icon={<HandCoins className="h-4 w-4" />} />
          Lepas Kartu & Ajukan Refund
        </Button>
      </Footer>
    </ActionDialog>
  );
}

/** Finance sudah mengembalikan uang → saldo di-nol-kan; wajib PIN supervisor. */
export function CompleteRefundDialog({ request, busy, onClose, onSubmit }: DialogBase & { request: RefundRequestRow }) {
  const [notes, setNotes] = useState("");
  const [pin, setPin] = useState("");
  return (
    <ActionDialog title={`Refund Completed — ${request.name || request.phone}`} busy={busy} onClose={onClose}>
      <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Saldo member saat ini</span>
          <span className="font-semibold text-emerald-700">{formatRupiah(request.current_balance)}</span>
        </div>
        <div className="mt-1 flex justify-between text-xs text-gray-500">
          <span>Diajukan {formatDateTime(request.requested_at, "—")}</span>
          <span>oleh {request.requested_by_name || "—"}</span>
        </div>
      </div>
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        Tandai hanya bila Finance sudah mengonfirmasi uang <strong>{formatRupiah(request.current_balance)}</strong>{" "}
        dikembalikan ke member. Saldo ARK member akan menjadi <strong>Rp0</strong> dan tercatat sebagai transaksi refund. XP
        tidak berubah.
      </p>
      <div>
        <p className="mb-1 text-sm font-semibold text-gray-700">Catatan Finance (opsional)</p>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="mis. transfer BCA 4 Sep, ref 123456"
        />
      </div>
      <div>
        <p className="mb-1 flex items-center gap-1 text-sm font-semibold text-gray-700">
          <Lock className="h-3.5 w-3.5" /> PIN supervisor
        </p>
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          aria-label="PIN supervisor"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          placeholder="Masukkan PIN supervisor"
          className="h-11 tracking-[0.3em]"
        />
      </div>
      <Footer busy={busy} onClose={onClose}>
        <Button
          className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
          disabled={busy || pin.length < 4}
          onClick={() => onSubmit({ kind: "complete", requestId: request.id, body: { supervisor_pin: pin, notes } })}
        >
          <BusyIcon busy={busy} icon={<CheckCircle2 className="h-4 w-4" />} />
          Tandai Refund Completed
        </Button>
      </Footer>
    </ActionDialog>
  );
}

export function CancelRefundDialog({ request, busy, onClose, onSubmit }: DialogBase & { request: RefundRequestRow }) {
  const [reason, setReason] = useState("");
  return (
    <ActionDialog
      title={`Batalkan permintaan refund — ${request.name || request.phone}`}
      busy={busy}
      onClose={onClose}
      wide={false}
    >
      <p className="text-sm text-gray-600">
        Permintaan dibatalkan, saldo member <strong>{formatRupiah(request.current_balance)}</strong> tetap utuh. Kartu yang
        sudah dilepas tidak dipasang kembali otomatis.
      </p>
      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Alasan pembatalan (opsional)" />
      <Footer busy={busy} onClose={onClose} cancelLabel="Kembali">
        <Button
          className="gap-2"
          variant="outline"
          disabled={busy}
          onClick={() => onSubmit({ kind: "cancel", requestId: request.id, body: { reason } })}
        >
          <BusyIcon busy={busy} icon={<Ban className="h-4 w-4" />} />
          Batalkan Permintaan
        </Button>
      </Footer>
    </ActionDialog>
  );
}
