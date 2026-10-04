"use client";

import { useState } from "react";
import { CheckCircle2, Handshake, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useRespondOffer } from "../queries";
import type { OfferRespondAction } from "../types";

const PROMPTS: Record<OfferRespondAction, string> = {
  accept: "Konfirmasi: Anda menerima penawaran ini?",
  negotiate: "Tuliskan catatan negosiasi Anda",
  decline: "Konfirmasi: Anda menolak penawaran ini?",
};

const CONFIRM_LABELS: Record<OfferRespondAction, string> = {
  accept: "Ya, Saya Terima",
  negotiate: "Kirim Pengajuan Nego",
  decline: "Ya, Saya Tolak",
};

/** Tombol Terima / Ajukan Nego / Tolak + konfirmasi dengan catatan. */
export function OfferResponseForm({ token }: { token: string }) {
  const [mode, setMode] = useState<OfferRespondAction | null>(null);
  const [note, setNote] = useState("");
  const respond = useRespondOffer(token);
  const submitting = respond.isPending;

  const submit = (action: OfferRespondAction) =>
    respond.mutate(
      { action, note: note.trim() || undefined },
      {
        onSuccess: () => {
          setMode(null);
          setNote("");
        },
      }
    );

  return (
    <>
      {mode === null ? (
        <div className="space-y-2">
          <Button type="button" className="w-full" disabled={submitting} onClick={() => setMode("accept")}>
            <CheckCircle2 className="size-4" /> Terima Penawaran
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={submitting}
              onClick={() => setMode("negotiate")}
            >
              <Handshake className="size-4" /> Ajukan Nego
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
              disabled={submitting}
              onClick={() => setMode("decline")}
            >
              <XCircle className="size-4" /> Tolak
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">{PROMPTS[mode]}</p>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={
              mode === "negotiate" ? "Contoh: Saya berharap gaji pokok Rp X juta karena…" : "Catatan tambahan (opsional)"
            }
          />
          <div className="flex gap-2">
            <Button
              type="button"
              className="flex-1"
              disabled={submitting || (mode === "negotiate" && !note.trim())}
              onClick={() => submit(mode)}
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {CONFIRM_LABELS[mode]}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => {
                setMode(null);
                respond.reset();
              }}
            >
              Batal
            </Button>
          </div>
        </div>
      )}

      {respond.error && <p className="text-sm text-red-600 dark:text-red-400">{respond.error.message}</p>}
    </>
  );
}
