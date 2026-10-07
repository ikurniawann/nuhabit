"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiah } from "@/lib/format";
import { offerSalaryNumber, parseOfferForm } from "@/lib/recruitment/pipeline-stage-rules";
import { useCreateOffer } from "../mutations";
import type { OfferSalaryReference } from "../types";
import { InviteLinkResult } from "./invite-link-result";
import type { StagePanelCandidate } from "./stage-panel-parts";

interface OfferSendDialogProps {
  candidate: StagePanelCandidate;
  positionTitle: string;
  salaryReference: OfferSalaryReference;
  hasOpenOffer: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_EXPIRES_DAYS = 7;

/**
 * Dialog "Buat Offer": gaji pokok + benefit + tanggal mulai + masa berlaku
 * → buat offer (token portal) → link salin / kirim via WA. Peringatan lunak
 * bila gaji melebihi salary_max posisi; revisi baru otomatis meng-expire
 * offer terbuka sebelumnya (di server).
 */
export function OfferSendDialog({
  candidate,
  positionTitle,
  salaryReference,
  hasOpenOffer,
  open,
  onOpenChange,
}: OfferSendDialogProps) {
  const createOffer = useCreateOffer();
  const [form, setForm] = useState({
    salary: "",
    benefitsText: "",
    startDate: "",
    notes: "",
    expiresDays: String(DEFAULT_EXPIRES_DAYS),
  });
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const salaryNumber = offerSalaryNumber(form.salary);
  const salaryMax = salaryReference.salary_max;
  const overBudget = salaryMax != null && salaryNumber > salaryMax;

  const handleCreate = () => {
    const parsed = parseOfferForm(form);
    if (!parsed.ok) return void toast.error(parsed.error);
    createOffer.mutate(
      { id: candidate.id, payload: parsed.value },
      {
        onSuccess: (offer) => {
          setCreatedLink(`${window.location.origin}/offer/${offer.token}`);
          toast.success(`Offer v${offer.version} dibuat`);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal membuat offer"),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>Buat Penawaran Kerja</DialogPanelTitle>
          <DialogPanelDescription>
            Kandidat melihat & merespons offer (terima / nego / tolak) lewat link token tanpa
            login — responsnya otomatis masuk ke panel ini.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          {createdLink ? (
            <InviteLinkResult
              intro="Offer dibuat. Bagikan link berikut ke kandidat:"
              link={createdLink}
              template="offer_terkirim"
              candidate={candidate}
              positionTitle={positionTitle}
              expiresDays={form.expiresDays}
            />
          ) : (
            <>
              {hasOpenOffer && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  Masih ada offer yang terbuka — membuat offer baru otomatis membatalkan
                  (meng-expire) offer sebelumnya.
                </p>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Gaji Pokok / bulan (Rp)</Label>
                <Input type="number" min={0} value={form.salary} onChange={set("salary")} placeholder="mis. 5500000" />
                {salaryNumber > 0 && <p className="text-xs text-muted-foreground">{formatRupiah(salaryNumber)}</p>}
                {overBudget && (
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    Melebihi budget posisi ({formatRupiah(salaryMax)}) — pastikan sudah disetujui atasan.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Benefit & Tunjangan (satu per baris)</Label>
                <Textarea
                  value={form.benefitsText}
                  onChange={set("benefitsText")}
                  rows={3}
                  placeholder={"BPJS Kesehatan & Ketenagakerjaan\nTunjangan makan & transport\nTHR"}
                />
              </div>
              <div className="flex flex-wrap gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Tanggal Mulai Kerja</Label>
                  <Input type="date" value={form.startDate} onChange={set("startDate")} className="w-40" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Masa Berlaku (hari)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    value={form.expiresDays}
                    onChange={set("expiresDays")}
                    className="w-28"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Catatan Internal (tidak dilihat kandidat)</Label>
                <Textarea
                  value={form.notes}
                  onChange={set("notes")}
                  rows={2}
                  maxLength={2000}
                  placeholder="mis. sudah approve BM, band gaji level 2"
                />
              </div>
            </>
          )}
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {createdLink ? "Tutup" : "Batal"}
          </Button>
          {!createdLink && (
            <Button type="button" onClick={handleCreate} disabled={createOffer.isPending}>
              {createOffer.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Buat Offer
            </Button>
          )}
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
