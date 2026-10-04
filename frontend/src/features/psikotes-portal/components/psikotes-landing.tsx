"use client";

import { useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { PortalSession, PortalTest } from "../types";

interface PsikotesLandingProps {
  session: PortalSession;
  tests: PortalTest[];
  starting: boolean;
  error: string | null;
  onStart: (webcamConsent: boolean) => void;
}

/** Landing sesi (draft/sent): daftar tes, aturan, dan consent kamera. */
export function PsikotesLanding({ session, tests, starting, error, onStart }: PsikotesLandingProps) {
  const [consent, setConsent] = useState(false);
  return (
    <Card className="w-full max-w-lg space-y-4 p-6">
      <div>
        <h1 className="text-lg font-semibold">Psikotes Online</h1>
        <p className="text-sm text-muted-foreground">
          Halo <span className="font-medium text-foreground">{session.candidate_name}</span>
          {session.position_title ? ` — posisi ${session.position_title}` : ""}. Anda akan
          mengerjakan {tests.length} tes berikut:
        </p>
      </div>

      <ul className="divide-y divide-border rounded-lg border border-border">
        {tests.map((test) => (
          <li key={test.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span>{test.instrument.name}</span>
            <span className="text-xs text-muted-foreground">
              {Math.round(test.instrument.duration_seconds / 60)} menit
            </span>
          </li>
        ))}
      </ul>

      <div className="space-y-2 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800">
        <p className="font-medium">Sebelum mulai:</p>
        <ul className="list-inside list-disc space-y-1">
          <li>Kerjakan sendiri di tempat tenang; jangan berpindah tab/aplikasi.</li>
          <li>Aktivitas berpindah tab, keluar layar penuh, dan paste akan tercatat.</li>
          <li>Siapkan kertas & alat tulis untuk tes gambar, dan kamera untuk memfoto hasil.</li>
        </ul>
      </div>

      <label className="flex items-start gap-2.5 rounded-lg border border-border px-4 py-3 text-sm">
        <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
        <span>
          <Camera className="mr-1 inline size-4 text-muted-foreground" />
          Saya mengizinkan kamera mengambil foto berkala selama tes sebagai bukti pengawasan
          (proctoring). Tanpa izin ini tes tetap bisa dikerjakan, namun tercatat tanpa bukti
          kamera.
        </span>
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button type="button" className="w-full" onClick={() => onStart(consent)} disabled={starting}>
        {starting && <Loader2 className="size-4 animate-spin" />}
        Mulai Sesi Tes
      </Button>
    </Card>
  );
}
