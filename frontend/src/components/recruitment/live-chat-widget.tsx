"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface LiveChatWidgetMessage {
  id: string;
  sender: "candidate" | "hr";
  sender_name: string | null;
  message: string;
  created_at: string;
}

const POLL_OPEN_MS = 4_000;
const POLL_CLOSED_MS = 12_000;

interface LiveChatWidgetProps {
  /** ambil pesan; `after` = ISO timestamp pesan terakhir yang sudah dimiliki */
  fetchMessages: (after?: string) => Promise<LiveChatWidgetMessage[]>;
  sendMessage: (message: string) => Promise<LiveChatWidgetMessage>;
  enabled: boolean;
}

/**
 * Widget chat mengambang utk portal kandidat (psikotes & interview AI):
 * kandidat bisa bertanya ke HRD saat sesi berjalan; balasan HRD masuk via
 * polling. Badge merah menandai pesan HRD yang belum dibaca.
 */
export function LiveChatWidget({ fetchMessages, sendMessage, enabled }: LiveChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<LiveChatWidgetMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const mergeMessages = useCallback((incoming: LiveChatWidgetMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const known = new Set(prev.map((m) => m.id));
      const fresh = incoming.filter((m) => !known.has(m.id));
      if (fresh.length === 0) return prev;
      if (!openRef.current) {
        const hrCount = fresh.filter((m) => m.sender === "hr").length;
        if (hrCount > 0) setUnread((u) => u + hrCount);
      }
      return [...prev, ...fresh];
    });
  }, []);

  // polling — interval pendek saat panel terbuka, panjang saat tertutup
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const last = messages[messages.length - 1]?.created_at;
        const next = await fetchMessages(last);
        if (!cancelled) mergeMessages(next);
      } catch {
        // polling gagal — coba lagi di tick berikutnya
      }
    };
    void poll();
    const timer = setInterval(poll, open ? POLL_OPEN_MS : POLL_CLOSED_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // messages sengaja tidak jadi dependency (pakai nilai saat tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, open, fetchMessages, mergeMessages]);

  // auto-scroll ke bawah saat ada pesan baru & panel terbuka
  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, open]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const saved = await sendMessage(text);
      setInput("");
      mergeMessages([saved]);
    } catch {
      // biarkan input utuh supaya kandidat bisa kirim ulang
    } finally {
      setSending(false);
    }
  };

  if (!enabled) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {open ? (
        <div className="flex h-96 w-80 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl">
          <div className="flex items-center justify-between bg-primary px-3 py-2 text-primary-foreground">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <MessageCircle className="size-4" /> Chat dengan HRD
            </span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Tutup chat">
              <X className="size-4" />
            </button>
          </div>
          <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <p className="pt-8 text-center text-xs text-muted-foreground">
                Ada yang ingin ditanyakan? Kirim pesan — HRD akan membalas di sini.
              </p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm ${
                    m.sender === "candidate"
                      ? "ml-auto bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {m.sender === "hr" && (
                    <p className="text-[10px] font-semibold opacity-70">
                      {m.sender_name ?? "HRD"}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{m.message}</p>
                  <p className="mt-0.5 text-right text-[9px] opacity-60">
                    {new Date(m.created_at).toLocaleTimeString("id-ID", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              ))
            )}
          </div>
          <div className="flex items-center gap-1.5 border-t border-border p-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              maxLength={1000}
              placeholder="Tulis pesan…"
              className="h-9 flex-1 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            <Button type="button" size="icon" onClick={handleSend} disabled={sending || !input.trim()}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setUnread(0);
          }}
          className="relative flex size-13 items-center justify-center rounded-full bg-primary p-3.5 text-primary-foreground shadow-lg transition-transform hover:scale-105"
          aria-label="Buka chat dengan HRD"
        >
          <MessageCircle className="size-6" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
