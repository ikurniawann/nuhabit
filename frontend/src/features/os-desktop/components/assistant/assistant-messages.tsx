"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { formatPlainChatText, pendingActionOutcome, type AssistantMessage, type PendingAction } from "../../lib/assistant-chat";

function PendingActionCard({
  action,
  busy,
  onDecide,
}: {
  action: PendingAction;
  busy: boolean;
  onDecide: (decision: "confirm" | "cancel") => void;
}) {
  return (
    <div className="mt-2 max-w-[85%] rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-200/90">
        <ShieldCheck className="size-3.5" /> Konfirmasi aksi
      </div>
      <p className="mt-1.5 leading-6 text-white/80">{action.summary}</p>
      {action.status === "pending" ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide("confirm")}
            className="inline-flex items-center gap-1.5 rounded-xl bg-pink-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-pink-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Jalankan aksi
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide("cancel")}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-1.5 text-[12px] text-white/70 transition hover:bg-white/15 disabled:opacity-50"
          >
            <X className="size-3.5" /> Batalkan
          </button>
          {action.result_note && <span className="text-[11px] text-amber-200/80">{action.result_note}</span>}
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-white/60">{pendingActionOutcome(action)}</p>
      )}
    </div>
  );
}

const MESSAGE_ACTION = "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-white/45 transition hover:bg-white/10 hover:text-white/80";

/**
 * Daftar pesan. Auto-scroll hanya saat user memang di dasar percakapan;
 * kalau ia menggulir ke atas membaca jawaban lama, jangan disentak turun.
 */
export function AssistantMessages({
  messages,
  loading,
  sessionId,
  actionBusyId,
  onDecide,
  onRegenerate,
}: {
  messages: AssistantMessage[];
  loading: boolean;
  sessionId: string | null;
  actionBusyId: string | null;
  onDecide: (index: number, actionId: string, decision: "confirm" | "cancel") => void;
  onRegenerate: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const scrollToBottom = (behavior: ScrollBehavior) => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  };

  // Masuk ke sebuah chat: langsung tampilkan bagian terbawah tanpa animasi.
  useEffect(() => {
    stickToBottom.current = true;
    const id = requestAnimationFrame(() => scrollToBottom("auto"));
    return () => cancelAnimationFrame(id);
  }, [sessionId]);

  // Pesan baru & indikator "Memproses..." sama-sama menambah tinggi konten.
  // Pesan user terakhir = user baru menekan Enter: tarik ke bawah apa pun posisinya.
  useEffect(() => {
    if (messages.at(-1)?.role === "user") stickToBottom.current = true;
    if (!stickToBottom.current) return;
    const id = requestAnimationFrame(() => scrollToBottom("smooth"));
    return () => cancelAnimationFrame(id);
  }, [messages, loading]);

  const copyMessage = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex((current) => (current === index ? null : current)), 1800);
    } catch {
      // clipboard diblokir (mis. konteks non-HTTPS): tombol tetap ada
    }
  };

  return (
    <div
      ref={listRef}
      onScroll={() => {
        const el = listRef.current;
        if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="flex-1 space-y-3 overflow-y-auto p-4"
    >
      {messages.map((message, index) => {
        const isAssistant = message.role === "assistant";
        const pending = isAssistant ? message.meta?.pending_action : undefined;
        // Ulangi hanya untuk jawaban terakhir: mengulang jawaban di tengah
        // percakapan membuat sisa riwayat tidak nyambung.
        const canRegenerate = isAssistant && index === messages.length - 1 && !loading;
        return (
          <div key={index} className={`group flex flex-col ${isAssistant ? "items-start" : "items-end"}`}>
            <div className={`max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-3 text-sm font-normal leading-6 ${isAssistant ? "bg-white/10 text-white/78" : "bg-pink-600 text-white"}`}>
              {formatPlainChatText(message.content)}
            </div>
            {pending && (
              <PendingActionCard action={pending} busy={actionBusyId === pending.id} onDecide={(decision) => onDecide(index, pending.id, decision)} />
            )}
            {isAssistant && (
              <div className="mt-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                <button type="button" onClick={() => void copyMessage(message.content, index)} className={MESSAGE_ACTION} title="Salin jawaban">
                  {copiedIndex === index ? <Check className="size-3" /> : <Copy className="size-3" />}
                  {copiedIndex === index ? "Tersalin" : "Salin"}
                </button>
                {canRegenerate && (
                  <button type="button" onClick={onRegenerate} className={MESSAGE_ACTION} title="Minta jawaban ulang">
                    <RefreshCw className="size-3" /> Ulangi
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {loading && (
        <div className="flex justify-start">
          <div className="flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm text-white/70">
            <Loader2 className="size-4 animate-spin" /> Memproses...
          </div>
        </div>
      )}
    </div>
  );
}
