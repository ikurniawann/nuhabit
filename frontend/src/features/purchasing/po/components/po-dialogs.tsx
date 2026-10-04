"use client";

import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SEND_VIA_OPTIONS, type BadgeTone, type SendVia } from "@/lib/purchasing/po-ui-status";

export function ToneBadge({ tone }: { tone: BadgeTone }) {
  return <Badge className={tone.className}>{tone.label}</Badge>;
}

const PANEL =
  "gap-0 overflow-hidden rounded-2xl border border-gray-200/70 p-0 shadow-xl ring-1 ring-gray-200/60 sm:max-w-[460px]";
const FOOTER = "mx-0 mb-0 gap-2 border-t border-gray-200/70 bg-gray-50/60 px-5 py-4 sm:justify-end";

function DialogShell({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = PANEL,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={className}>
        <DialogHeader className="border-b border-gray-200/70 px-5 py-4">
          <DialogTitle className="text-base font-semibold text-gray-900">{title}</DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-5 text-gray-500">{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

interface ConfirmPODialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
}

export function ConfirmPODialog({ confirmLabel, pending, onConfirm, ...shell }: ConfirmPODialogProps) {
  return (
    <DialogShell {...shell} className={PANEL.replace("460px", "420px")}>
      <DialogFooter className={FOOTER}>
        <Button
          variant="outline"
          onClick={() => shell.onOpenChange(false)}
          disabled={pending}
          className="purchasing-secondary-button"
        >
          Batal
        </Button>
        <Button onClick={onConfirm} disabled={pending} className="purchasing-main-button">
          {pending ? "Memproses..." : confirmLabel}
        </Button>
      </DialogFooter>
    </DialogShell>
  );
}

interface SendPODialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  poNumber?: string;
  pending: boolean;
  onConfirm: (sendVia: SendVia) => void;
}

/** Pilih metode kirim PO ke pemasok; pilihan kembali ke Email setiap dialog dibuka. */
export function SendPODialog({ title, poNumber, pending, onConfirm, ...shell }: SendPODialogProps) {
  return (
    <DialogShell {...shell} title={title} description={`Pilih metode pengiriman untuk purchase order ${poNumber ?? ""}`}>
      <SendPOForm pending={pending} onCancel={() => shell.onOpenChange(false)} onConfirm={onConfirm} />
    </DialogShell>
  );
}

function SendPOForm({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  onCancel: () => void;
  onConfirm: (sendVia: SendVia) => void;
}) {
  const [sendVia, setSendVia] = useState<SendVia>("EMAIL");
  return (
    <>
      <div className="space-y-1.5 px-5 py-4">
        <Label className="text-xs">Metode Pengiriman</Label>
        <Combobox
          options={[...SEND_VIA_OPTIONS]}
          value={sendVia}
          onChange={(value) => setSendVia(value as SendVia)}
          placeholder="Pilih metode..."
          searchPlaceholder="Cari metode..."
          emptyMessage="Metode tidak ditemukan"
          className="!w-full h-9 text-sm"
        />
      </div>
      <DialogFooter className={FOOTER}>
        <Button variant="outline" onClick={onCancel} disabled={pending} className="purchasing-secondary-button">
          Batal
        </Button>
        <Button onClick={() => onConfirm(sendVia)} disabled={pending} className="purchasing-main-button">
          {pending ? "Mengirim..." : "Kirim"}
        </Button>
      </DialogFooter>
    </>
  );
}

interface ReasonPODialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  label: string;
  placeholder: string;
  confirmLabel: string;
  confirmIcon?: ReactNode;
  destructive?: boolean;
  pending: boolean;
  onConfirm: (reason: string) => void;
}

/** Dialog alasan wajib (batalkan/tutup PO); alasan dikosongkan setiap dialog dibuka. */
export function ReasonPODialog({
  label,
  placeholder,
  confirmLabel,
  confirmIcon,
  destructive,
  pending,
  onConfirm,
  ...shell
}: ReasonPODialogProps) {
  return (
    <DialogShell {...shell}>
      <ReasonForm
        label={label}
        placeholder={placeholder}
        confirmLabel={confirmLabel}
        confirmIcon={confirmIcon}
        destructive={destructive}
        pending={pending}
        onCancel={() => shell.onOpenChange(false)}
        onConfirm={onConfirm}
      />
    </DialogShell>
  );
}

function ReasonForm({
  label,
  placeholder,
  confirmLabel,
  confirmIcon,
  destructive,
  pending,
  onCancel,
  onConfirm,
}: Omit<ReasonPODialogProps, "open" | "onOpenChange" | "title" | "description"> & { onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  return (
    <>
      <div className="space-y-1.5 px-5 py-4">
        <Label className="text-xs">{label} *</Label>
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={placeholder}
          className="h-9 text-sm"
        />
      </div>
      <DialogFooter className={FOOTER}>
        <Button variant="outline" onClick={onCancel} disabled={pending} className="purchasing-secondary-button">
          Batal
        </Button>
        <Button
          variant={destructive ? "destructive" : "default"}
          onClick={() => onConfirm(trimmed)}
          disabled={!trimmed || pending}
          className="purchasing-main-button"
        >
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : confirmIcon}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
