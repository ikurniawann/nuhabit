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
import { parseExpiresDays, parseMaxQuestions } from "@/lib/recruitment/pipeline-stage-rules";
import { useCreateInterviewSession } from "../mutations";
import { InviteLinkResult } from "./invite-link-result";
import type { StagePanelCandidate } from "./stage-panel-parts";

interface InterviewSendDialogProps {
  candidate: StagePanelCandidate;
  positionTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_EXPIRES_DAYS = 3;
const DEFAULT_MAX_QUESTIONS = 8;

/**
 * Dialog "Kirim undangan interview AI": jumlah pertanyaan & masa berlaku →
 * buat sesi + token → link (salin / kirim via WA). Kandidat interview via
 * /interview/[token].
 */
export function InterviewSendDialog({ candidate, positionTitle, open, onOpenChange }: InterviewSendDialogProps) {
  const createSession = useCreateInterviewSession();
  const [expiresDays, setExpiresDays] = useState(String(DEFAULT_EXPIRES_DAYS));
  const [maxQuestions, setMaxQuestions] = useState(String(DEFAULT_MAX_QUESTIONS));
  const [createdLink, setCreatedLink] = useState<string | null>(null);

  const handleCreate = () => {
    const days = parseExpiresDays(expiresDays);
    if (!days.ok) return void toast.error(days.error);
    const questions = parseMaxQuestions(maxQuestions);
    if (!questions.ok) return void toast.error(questions.error);
    createSession.mutate(
      { id: candidate.id, payload: { expires_days: days.value, max_questions: questions.value } },
      {
        onSuccess: (session) => {
          setCreatedLink(`${window.location.origin}/interview/${session.token}`);
          toast.success("Undangan interview dibuat");
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal membuat undangan"),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>Kirim Undangan Interview AI</DialogPanelTitle>
          <DialogPanelDescription>
            Kandidat diwawancara AI (suara, wajib on-cam) lewat link token tanpa login — transkrip
            & kesimpulan otomatis masuk ke panel ini.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          {createdLink ? (
            <InviteLinkResult
              intro="Undangan dibuat. Bagikan link berikut ke kandidat:"
              link={createdLink}
              template="undangan_interview"
              candidate={candidate}
              positionTitle={positionTitle}
              expiresDays={expiresDays}
            />
          ) : (
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Maks Pertanyaan</Label>
                <Input
                  type="number"
                  min={3}
                  max={15}
                  value={maxQuestions}
                  onChange={(e) => setMaxQuestions(e.target.value)}
                  className="w-28"
                />
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
              <p className="w-full text-xs text-muted-foreground">
                AI menanyakan topik basic: perkenalan & pengalaman, keahlian, motivasi,
                ketersediaan, dan ekspektasi gaji — lalu menyimpulkan relevansi kandidat.
              </p>
            </div>
          )}
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {createdLink ? "Tutup" : "Batal"}
          </Button>
          {!createdLink && (
            <Button type="button" onClick={handleCreate} disabled={createSession.isPending}>
              {createSession.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Buat Undangan
            </Button>
          )}
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
