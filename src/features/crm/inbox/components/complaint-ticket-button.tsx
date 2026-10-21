"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, TicketCheck } from "lucide-react";
import { useIamAccess } from "@/components/iam/iam-access-provider";
import { COMPLAINT_STATUS_LABEL, type ComplaintStatus } from "@/lib/studio/complaints";

/**
 * EPIC-067 T-067-B1 — "Buat tiket keluhan" dari percakapan WA (satu klik).
 * Hanya tampil bagi yang punya akses menu Keluhan Pelanggan; percakapan yang
 * sudah punya tiket aktif menampilkan tiketnya.
 */

type Ticket = { id: string; code: string; status: ComplaintStatus };

export function ComplaintTicketButton({ conversationId }: { conversationId: string }) {
  const { hasPrefix } = useIamAccess();
  const allowed = hasPrefix(["studio.complaints"]);
  const [ticket, setTicket] = useState<{ conv: string; value: Ticket | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    fetch(`/api/studio/complaints?wa_conversation_id=${conversationId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => !cancelled && setTicket({ conv: conversationId, value: j.data ?? null }))
      .catch(() => !cancelled && setTicket({ conv: conversationId, value: null }));
    return () => {
      cancelled = true;
    };
  }, [allowed, conversationId]);

  if (!allowed) return null;
  const current = ticket?.conv === conversationId ? ticket.value : undefined;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/studio/complaints/from-wa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wa_conversation_id: conversationId }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 409 && j.details?.id) {
        setTicket({ conv: conversationId, value: j.details as Ticket });
        return;
      }
      if (!res.ok) throw new Error(j.error ?? "Gagal membuat tiket");
      setTicket({ conv: conversationId, value: { ...j.data, status: "received" } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat tiket");
    } finally {
      setBusy(false);
    }
  }

  if (current === undefined) return <Loader2 className="size-3.5 animate-spin text-slate-400" />;
  if (current) {
    return (
      <Link
        href="/dashboard/studio/complaints"
        className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
      >
        <TicketCheck className="size-3.5 text-emerald-600" />
        Tiket <span className="font-mono font-semibold">{current.code}</span> · {COMPLAINT_STATUS_LABEL[current.status]}
      </Link>
    );
  }
  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={busy}
        onClick={create}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <TicketCheck className="size-3.5" />}
        Buat tiket keluhan
      </button>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
