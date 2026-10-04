"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, ChevronLeft, History, Plus } from "lucide-react";
import { brandName } from "@/lib/branding";
import type { AssistantChat } from "../../hooks/use-assistant-chat";
import type { AssistantSession } from "../../lib/assistant-chat";
import { OS_LOGIN_HREF } from "../../lib/modules";
import { WindowShell } from "../windows/window-shell";
import { AssistantComposer } from "./assistant-composer";
import { AssistantMessages } from "./assistant-messages";
import { PreviousSessions, SessionSidebar } from "./assistant-sessions";

const STATUS_BADGE = {
  live: { label: "Do Live", className: "bg-emerald-400/15 text-emerald-200" },
  fallback: { label: "Fallback", className: "bg-amber-400/15 text-amber-200" },
  ready: { label: "Ready", className: "bg-white/10 text-white/55" },
} as const;

/**
 * Jendela asisten Do. Terbuka untuk semua yang login; yang dibatasi adalah
 * ALAT-nya: server hanya menawarkan alat sesuai menu IAM (tool-scope.ts),
 * jadi kasir bisa bertanya stok tanpa bisa menarik data HRIS.
 */
export function AssistantWindow({ chat, isAllowed, onClose }: { chat: AssistantChat; isAllowed: boolean; onClose: () => void }) {
  const [showHistory, setShowHistory] = useState(false);
  const { scope, model } = chat;
  const badge = STATUS_BADGE[chat.status];
  const rename = (session: AssistantSession) => {
    const next = window.prompt("Judul baru untuk chat ini:", session.title || "");
    const title = next?.trim();
    if (title && title !== session.title) chat.renameSession(session.id, title);
  };
  const remove = (id: string) => {
    if (window.confirm("Hapus session chat ini?")) chat.deleteSession(id);
  };

  return (
    <WindowShell title="Do" onClose={onClose} className="right-5 top-14 flex h-[min(760px,calc(100vh-86px))] w-[min(780px,calc(100vw-32px))] flex-col">
      <div className="flex h-full overflow-hidden">
        {showHistory && (
          <SessionSidebar
            sessions={chat.sessions}
            activeId={chat.sessionId}
            onNewChat={chat.newChat}
            onOpen={(id) => {
              setShowHistory(false);
              chat.loadSession(id);
            }}
            onRename={rename}
            onDelete={remove}
          />
        )}

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b border-white/10 p-3">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-2xl bg-accent text-accent-foreground">
                <Bot className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">Do</div>
                <div className="truncate text-xs text-white/50">{isAllowed ? `${scope.label} · ${model.label}` : "Masuk dulu untuk memakai Do"}</div>
              </div>
              {chat.view === "chat" && (
                <button
                  onClick={chat.showLanding}
                  className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/55 transition hover:bg-white/15"
                  title="Kembali ke daftar session"
                >
                  <ChevronLeft className="size-3" />
                  Sessions
                </button>
              )}
              <button
                onClick={() => setShowHistory((v) => !v)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${showHistory ? "bg-pink-600 text-white" : "bg-white/10 text-white/55 hover:bg-white/15"}`}
                title="Toggle history sidebar"
              >
                <History className="mr-1 inline size-3" />
                History
              </button>
              <div className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.className}`} title={chat.statusNote}>
                {badge.label}
              </div>
            </div>
          </div>

          {!isAllowed ? (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <Bot className="mb-4 size-12 text-pink-200" />
              <h3 className="text-lg font-semibold">Akses dibatasi</h3>
              <p className="mt-2 text-sm leading-6 text-white/60">Masuk dulu untuk memakai Do. Data yang bisa dibacakan Do mengikuti hak akses menu Anda.</p>
              <Link href={OS_LOGIN_HREF} className="mt-5 rounded-2xl bg-pink-600 px-5 py-3 text-sm font-semibold hover:bg-pink-500">
                Login Super User
              </Link>
            </div>
          ) : chat.view === "landing" ? (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <div className="mb-5 grid size-16 place-items-center rounded-3xl bg-accent text-accent-foreground shadow-xl">
                <Bot className="size-8" />
              </div>
              <h3 className="text-xl font-bold text-white/90">Do</h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-white/55">
                Asisten operasional {brandName()}. Data yang bisa diakses mengikuti hak menu Anda. Mode {scope.label} memakai {model.label}.
              </p>
              <button
                onClick={chat.newChat}
                className="mt-6 flex items-center gap-2 rounded-2xl bg-gradient-to-r from-pink-500 to-pink-700 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:from-pink-400 hover:to-pink-600"
              >
                <Plus className="size-4" />
                Start New Chat
              </button>
              <PreviousSessions sessions={chat.sessions} onOpen={chat.loadSession} onRename={rename} onDelete={remove} />
            </div>
          ) : (
            <>
              <AssistantMessages
                messages={chat.messages}
                loading={chat.loading}
                sessionId={chat.sessionId}
                actionBusyId={chat.actionBusyId}
                onDecide={chat.decideAction}
                onRegenerate={chat.regenerate}
              />
              <AssistantComposer
                statusNote={chat.statusNote}
                showBackToSessions={Boolean(chat.sessionId)}
                onBackToSessions={chat.showLanding}
                attachments={chat.attachments}
                uploading={chat.uploading}
                uploadError={chat.uploadError}
                onAttach={chat.attach}
                onRemoveAttachment={chat.removeAttachment}
                input={chat.input}
                onInputChange={chat.setInput}
                onSend={() => chat.sendMessage()}
                sending={chat.loading}
                placeholder={
                  scope.id === "general"
                    ? "Tanyakan apapun... (Shift+Enter untuk baris baru)"
                    : "Tanyakan data Talentpool atau hal umum... (Shift+Enter untuk baris baru)"
                }
              />
            </>
          )}
        </div>
      </div>
    </WindowShell>
  );
}
