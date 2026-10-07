"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Loader2,
  MessageSquareText,
  Send,
  Smartphone,
  UserCheck,
  UserMinus,
} from "lucide-react";
import type {
  ConversationStatus,
  InboxConversation,
  InboxMessage,
  ReplyTemplate,
} from "../types";
import { STATUS_LABELS, STATUS_STYLES } from "../types";
import type { ConversationAction } from "../api";
import { conversationTitle, withDateSeparators } from "../inbox-format";
import { formatTime } from "@/lib/format";
import { ConversationInsightCard } from "./conversation-insight-card";

/**
 * Panel tengah — thread chat + komposer balasan + aksi status/assign.
 * Pemanggil memberi `key={conversation.id}` supaya draf & menu reset saat pindah percakapan.
 */

export function ChatPanel({
  conversation,
  messages,
  templates,
  busy,
  onReply,
  onAction,
}: {
  conversation: InboxConversation;
  messages: InboxMessage[];
  templates: ReplyTemplate[];
  busy: boolean;
  onReply: (message: string) => Promise<boolean>;
  onAction: (payload: ConversationAction) => void;
}) {
  const [draft, setDraft] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, conversation.id]);

  async function submit() {
    const message = draft.trim();
    if (!message || busy) return;
    const sent = await onReply(message);
    if (sent) setDraft("");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">
            {conversationTitle(conversation)}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
            <span className={`rounded-full border px-2 py-0.5 font-medium ${STATUS_STYLES[conversation.status]}`}>
              {STATUS_LABELS[conversation.status]}
            </span>
            {conversation.assigned_name ? (
              <span>Ditangani {conversation.assigned_name}</span>
            ) : (
              <span className="text-amber-600">Belum ada yang menangani</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {conversation.assigned_user_id ? (
            <button
              type="button"
              onClick={() => onAction({ action: "unassign" })}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              <UserMinus className="size-3.5" /> Lepas
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onAction({ action: "assign_me" })}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              <UserCheck className="size-3.5" /> Tangani
            </button>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowStatus((current) => !current)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Status <ChevronDown className="size-3.5" />
            </button>
            {showStatus && (
              <div className="absolute right-0 top-9 z-10 w-44 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                {(Object.keys(STATUS_LABELS) as ConversationStatus[]).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => {
                      setShowStatus(false);
                      onAction({ action: "set_status", status });
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50 ${
                      status === conversation.status ? "font-semibold text-slate-900" : "text-slate-600"
                    }`}
                  >
                    {status === "resolved" && <CheckCircle2 className="size-3.5 text-emerald-600" />}
                    {STATUS_LABELS[status]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* EPIC-029 — ringkasan AI percakapan ini (hanya baca cache saat dibuka). */}
      <ConversationInsightCard conversationId={conversation.id} />

      <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-4">
        {withDateSeparators(messages).map(({ message, dateLabel }) => {
          const outbound = message.direction === "out";

          return (
            <div key={message.id}>
              {dateLabel && (
                <div className="my-3 text-center text-[11px] text-slate-400">{dateLabel}</div>
              )}
              <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                    outbound
                      ? "rounded-br-sm bg-violet-600 text-white"
                      : "rounded-bl-sm border border-slate-200 bg-white text-slate-800"
                  }`}
                >
                  {message.body ? (
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  ) : (
                    <p className="italic opacity-70">[{message.media_type ?? "pesan"}]</p>
                  )}
                  <div
                    className={`mt-1 flex items-center gap-1.5 text-[10px] ${
                      outbound ? "text-violet-200" : "text-slate-400"
                    }`}
                  >
                    {formatTime(message.created_at)}
                    {outbound && message.sent_by_name && <span>· {message.sent_by_name}</span>}
                    {outbound && message.wa_from_me && (
                      <span className="inline-flex items-center gap-0.5">
                        · <Smartphone className="size-2.5" /> dari HP
                      </span>
                    )}
                    {message.status === "failed" && (
                      <span className="font-semibold text-red-300">· gagal</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-200 bg-white p-3">
        {showTemplates && templates.length > 0 && (
          <div className="mb-2 max-h-40 overflow-y-auto rounded-md border border-slate-200">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => {
                  setDraft(template.body);
                  setShowTemplates(false);
                }}
                className="block w-full border-b border-slate-100 px-3 py-2 text-left text-xs last:border-0 hover:bg-slate-50"
              >
                <div className="font-medium text-slate-800">{template.title}</div>
                <div className="mt-0.5 line-clamp-1 text-slate-500">{template.body}</div>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => setShowTemplates((current) => !current)}
            title="Template balasan"
            className={`grid size-10 shrink-0 place-items-center rounded-md border transition ${
              showTemplates
                ? "border-violet-300 bg-violet-50 text-violet-700"
                : "border-slate-300 bg-white text-slate-500 hover:bg-slate-100"
            }`}
          >
            <MessageSquareText className="size-4" />
          </button>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            rows={1}
            placeholder="Tulis balasan... (Enter kirim, Shift+Enter baris baru)"
            className="max-h-32 min-h-10 flex-1 resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !draft.trim()}
            className="grid size-10 shrink-0 place-items-center rounded-md bg-violet-600 text-white transition hover:bg-violet-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
