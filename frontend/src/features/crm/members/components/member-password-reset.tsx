"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, MessageCircle } from "lucide-react";
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
import { useIamAccess } from "@/components/iam/iam-access-provider";
import { IAM } from "@/lib/iam/prefixes";
import { useResetMemberPassword } from "../mutations";
import { errorText } from "./member-detail-ui";

type Outcome = { kind: "shown"; password: string } | { kind: "sent"; phone: string };

/**
 * Staff reset of the member portal password. Every call makes a new password
 * and signs the member out everywhere; the password is shown once or sent by
 * WhatsApp, never both from one call.
 */
export function MemberPasswordReset({ memberId, phone }: { memberId: string; phone: string | null }) {
  const canUpdate = useIamAccess().hasPrefix(IAM.crmMembers);
  const reset = useResetMemberPassword();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!canUpdate) return null;

  const run = async (sendWhatsapp: boolean) => {
    setError(null);
    setCopied(false);
    try {
      const data = await reset.mutateAsync({ id: memberId, sendWhatsapp });
      setOutcome(sendWhatsapp && phone ? { kind: "sent", phone } : { kind: "shown", password: data.password ?? "" });
    } catch (err) {
      setError(errorText(err, "Gagal mereset password member"));
    }
  };

  const copy = async (password: string) => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setError("Tidak bisa menyalin. Salin password secara manual.");
    }
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setOutcome(null);
      setError(null);
      setCopied(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
      >
        <KeyRound className="size-4" />
        Reset password portal
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogPanel size="xs">
          <DialogPanelHeader>
            <DialogPanelTitle>Reset password portal member</DialogPanelTitle>
            <DialogPanelDescription>
              {outcome
                ? "Password lama tidak berlaku lagi dan semua sesi member sudah dikeluarkan."
                : "Sistem membuat password baru dan mengeluarkan member dari semua perangkat."}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-3">
            {outcome?.kind === "shown" ? (
              <>
                <p className="text-xs text-slate-500">Password hanya ditampilkan sekali. Sampaikan ke member sekarang.</p>
                <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <code className="flex-1 font-mono text-base font-semibold tracking-wide text-slate-950">{outcome.password}</code>
                  <Button type="button" variant="outline" size="sm" onClick={() => void copy(outcome.password)}>
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? "Tersalin" : "Salin"}
                  </Button>
                </div>
                {phone ? (
                  <p className="text-xs text-slate-500">
                    Kirim via WhatsApp membuat password baru lagi dan mengirimnya ke {phone}; password di atas tidak berlaku.
                  </p>
                ) : null}
              </>
            ) : outcome?.kind === "sent" ? (
              <p className="text-sm text-slate-700">Password baru dikirim ke WhatsApp {outcome.phone}.</p>
            ) : (
              <p className="text-sm text-slate-700">
                {phone
                  ? "Tampilkan password untuk disampaikan langsung, atau kirim ke WhatsApp member."
                  : "Member belum punya nomor WhatsApp, jadi password ditampilkan di sini."}
              </p>
            )}
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={reset.isPending}>
              Tutup
            </Button>
            {outcome?.kind !== "sent" ? (
              <>
                {phone ? (
                  <Button type="button" variant="ink" onClick={() => void run(true)} disabled={reset.isPending}>
                    <MessageCircle className="size-4" />
                    Kirim via WhatsApp
                  </Button>
                ) : null}
                {outcome ? null : (
                  <Button type="button" onClick={() => void run(false)} disabled={reset.isPending}>
                    <KeyRound className="size-4" />
                    {reset.isPending ? "Memproses..." : "Tampilkan password"}
                  </Button>
                )}
              </>
            ) : null}
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </>
  );
}
