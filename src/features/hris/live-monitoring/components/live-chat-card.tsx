"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatTime } from "@/lib/format";
import { useLiveChat, useSendLiveChat } from "../queries";
import type { LiveSessionType } from "../api";

/** Live chat dua arah HRD ↔ kandidat (polling 4 dtk). */
export function LiveChatCard({ type, sessionId }: { type: LiveSessionType; sessionId: string }) {
  const { data: messages = [] } = useLiveChat(type, sessionId);
  const send = useSendLiveChat(type, sessionId);
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  // gulir ke pesan terbaru (sinkron ke DOM, bukan state)
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || send.isPending) return;
    // gagal: biarkan input utuh
    send.mutate(text, { onSuccess: () => setInput("") });
  };

  return (
    <Card className="flex h-[480px] flex-col p-0">
      <div className="flex items-center gap-1.5 border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-800">
        <MessageCircle className="size-4 text-emerald-500" /> Live Chat dengan Kandidat
      </div>
      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <p className="pt-10 text-center text-xs text-gray-400">
            Belum ada pesan. Sapa kandidat atau jawab pertanyaannya di sini.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm ${
                m.sender === "hr" ? "ml-auto bg-blue-600 text-white" : "bg-gray-100 text-gray-800"
              }`}
            >
              <p className="text-[10px] font-semibold opacity-70">
                {m.sender_name ?? (m.sender === "hr" ? "HRD" : "Kandidat")}
              </p>
              <p className="whitespace-pre-wrap break-words">{m.message}</p>
              <p className="mt-0.5 text-right text-[9px] opacity-60">{formatTime(m.created_at)}</p>
            </div>
          ))
        )}
      </div>
      <div className="flex items-center gap-1.5 border-t border-gray-100 p-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          maxLength={1000}
          placeholder="Tulis pesan ke kandidat…"
          className="h-9 flex-1 rounded-md border border-gray-200 px-2.5 text-sm outline-none focus:ring-1 focus:ring-blue-300"
        />
        <Button type="button" size="icon" onClick={handleSend} disabled={send.isPending || !input.trim()}>
          {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
    </Card>
  );
}
