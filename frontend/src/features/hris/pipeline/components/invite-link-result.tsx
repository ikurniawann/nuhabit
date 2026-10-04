"use client";

import { useState } from "react";
import { Check, Copy, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildWaLink } from "@/lib/recruitment/wa";
import {
  INVITE_WA_MESSAGES,
  type InviteTemplateKey,
} from "@/lib/recruitment/pipeline-wa-templates";
import { useLogWaTemplate } from "../mutations";

/** Undangan yang baru dibuat: link + salin + kirim via WA (tercatat di aktivitas). */
export function InviteLinkResult({
  intro,
  link,
  template,
  candidate,
  positionTitle,
  expiresDays,
}: {
  intro: string;
  link: string;
  template: InviteTemplateKey;
  candidate: { id: string; full_name: string; phone?: string | null };
  positionTitle: string;
  expiresDays: string;
}) {
  const logWa = useLogWaTemplate();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(link).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWa = () => {
    const message = INVITE_WA_MESSAGES[template]({
      nama: candidate.full_name,
      posisi: positionTitle,
      link,
      expiresDays,
    });
    const waLink = buildWaLink(candidate.phone, message);
    if (!waLink) {
      toast.error("Nomor HP kandidat belum diisi");
      return;
    }
    window.open(waLink, "_blank", "noopener,noreferrer");
    logWa.mutate({ id: candidate.id, template });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-emerald-700 dark:text-emerald-400">{intro}</p>
      <div className="flex items-center gap-2">
        <Input readOnly value={link} className="text-xs" />
        <Button type="button" variant="outline" size="icon" onClick={handleCopy} aria-label="Salin link">
          {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
        </Button>
      </div>
      <Button type="button" className="w-full" onClick={handleWa} disabled={!candidate.phone}>
        <MessageCircle className="size-4" /> Kirim via WhatsApp
      </Button>
      {!candidate.phone && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Nomor HP kandidat belum diisi — salin link secara manual.
        </p>
      )}
    </div>
  );
}
