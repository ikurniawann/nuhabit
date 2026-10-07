"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { parseExpiresDays } from "@/lib/recruitment/pipeline-stage-rules";
import { usePsikotesInstruments } from "@/features/hris/psikotes/queries";
import { useCreatePsikotesSession } from "../mutations";
import { InviteLinkResult } from "./invite-link-result";
import type { StagePanelCandidate } from "./stage-panel-parts";

interface PsikotesSendDialogProps {
  candidate: StagePanelCandidate;
  positionTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_EXPIRES_DAYS = 3;

/**
 * Dialog "Kirim / jadwalkan tes": pilih instrumen aktif (default semua),
 * masa berlaku → buat sesi + token → tampilkan link (salin / kirim via WA).
 * Di-mount kondisional oleh panel, jadi state segar tiap kali dibuka.
 */
export function PsikotesSendDialog({ candidate, positionTitle, open, onOpenChange }: PsikotesSendDialogProps) {
  const instrumentsQuery = usePsikotesInstruments(open);
  const createSession = useCreatePsikotesSession();

  const activeInstruments = (instrumentsQuery.data ?? []).filter((i) => i.is_active);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [expiresDays, setExpiresDays] = useState(String(DEFAULT_EXPIRES_DAYS));
  const [createdLink, setCreatedLink] = useState<string | null>(null);

  const selectedIds = activeInstruments.filter((i) => !excluded.has(i.id)).map((i) => i.id);

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const handleCreate = () => {
    const days = parseExpiresDays(expiresDays);
    if (!days.ok) return void toast.error(days.error);
    if (selectedIds.length === 0) return void toast.error("Pilih minimal satu instrumen");
    createSession.mutate(
      { id: candidate.id, payload: { instrument_ids: selectedIds, expires_days: days.value } },
      {
        onSuccess: (session) => {
          setCreatedLink(`${window.location.origin}/psikotes/${session.token}`);
          toast.success("Undangan tes dibuat");
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal membuat undangan"),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>Kirim / Jadwalkan Tes</DialogPanelTitle>
          <DialogPanelDescription>
            Kandidat mengerjakan lewat link token tanpa login — hasil otomatis masuk ke panel ini.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          {createdLink ? (
            <InviteLinkResult
              intro="Undangan dibuat. Bagikan link berikut ke kandidat:"
              link={createdLink}
              template="undangan_psikotes"
              candidate={candidate}
              positionTitle={positionTitle}
              expiresDays={expiresDays}
            />
          ) : instrumentsQuery.isLoading ? (
            <div className="flex justify-center py-8 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label className="text-xs font-medium">Instrumen Tes</Label>
                <div className="divide-y divide-border rounded-lg border border-border">
                  {activeInstruments.map((instrument) => (
                    <label key={instrument.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm">
                      <Checkbox
                        checked={!excluded.has(instrument.id)}
                        onCheckedChange={() => toggle(instrument.id)}
                      />
                      <span className="flex-1">{instrument.name}</span>
                      {instrument.kind !== "drawing" && instrument.active_question_count === 0 && (
                        <span className="text-xs text-amber-600">bank soal kosong</span>
                      )}
                    </label>
                  ))}
                  {activeInstruments.length === 0 && (
                    <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                      Tidak ada instrumen aktif — aktifkan di menu Psikotes.
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Masa Berlaku (hari)</Label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={expiresDays}
                  onChange={(e) => setExpiresDays(e.target.value)}
                  className="w-28"
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
            <Button type="button" onClick={handleCreate} disabled={createSession.isPending || selectedIds.length === 0}>
              {createSession.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Buat Undangan
            </Button>
          )}
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
