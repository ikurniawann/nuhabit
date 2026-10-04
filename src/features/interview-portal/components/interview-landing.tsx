"use client";

import { useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { InterviewPortalSession } from "../types";

interface InterviewLandingProps {
  session: InterviewPortalSession;
  starting: boolean;
  error: string | null;
  onStart: () => void;
}

/** Landing undangan (status sent): aturan on-cam + consent kamera & mikrofon. */
export function InterviewLanding({ session, starting, error, onStart }: InterviewLandingProps) {
  const [consent, setConsent] = useState(false);
  return (
    <Card className="w-full max-w-lg space-y-4 p-6">
      <div>
        <h1 className="text-lg font-semibold">Interview Online dengan AI</h1>
        <p className="text-sm text-muted-foreground">
          Halo <span className="font-medium text-foreground">{session.candidate_name}</span>
          {session.position_title ? ` — posisi ${session.position_title}` : ""}. AI interviewer
          kami akan menanyakan maksimal {session.max_questions} pertanyaan singkat seputar
          pengalaman, keahlian, dan ekspektasi Anda.
        </p>
      </div>

      <div className="space-y-2 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
        <p className="font-medium">Sebelum mulai:</p>
        <ul className="list-inside list-disc space-y-1">
          <li>
            Interview ini <b>wajib on-cam</b>: kamera & mikrofon harus aktif sepanjang sesi.
          </li>
          <li>Pertanyaan dibacakan dengan suara; jawab dengan berbicara ke mikrofon.</li>
          <li>Pastikan wajah Anda selalu terlihat di kamera dan berada di tempat tenang.</li>
          <li>Berpindah tab, keluar layar penuh, dan keluar dari frame kamera akan tercatat.</li>
        </ul>
      </div>

      <label className="flex items-start gap-2.5 rounded-lg border border-border px-4 py-3 text-sm">
        <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
        <span>
          <Camera className="mr-1 inline size-4 text-muted-foreground" />
          Saya mengizinkan kamera & mikrofon aktif selama interview, termasuk foto berkala dan
          rekaman jawaban suara saya untuk keperluan penilaian rekrutmen.
        </span>
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Button type="button" className="w-full" onClick={onStart} disabled={starting || !consent}>
        {starting && <Loader2 className="size-4 animate-spin" />}
        Mulai Interview
      </Button>
    </Card>
  );
}
