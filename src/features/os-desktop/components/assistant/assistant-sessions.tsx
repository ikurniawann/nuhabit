"use client";

import { ChevronRight, MessageSquareMore, Pencil, Plus, Trash2 } from "lucide-react";
import type { AssistantSession } from "../../lib/assistant-chat";

type SessionActions = {
  onOpen: (id: string) => void;
  onRename: (session: AssistantSession) => void;
  onDelete: (id: string) => void;
};

function SessionRowActions({
  session,
  onRename,
  onDelete,
  size,
  trailing,
}: Omit<SessionActions, "onOpen"> & { session: AssistantSession; size: string; trailing: string }) {
  return (
    <>
      <button
        onClick={() => onRename(session)}
        className={`grid ${size} shrink-0 place-items-center rounded-lg text-white/35 transition hover:bg-white/12 hover:text-white/80`}
        title="Ganti nama session"
      >
        <Pencil className="size-3.5" />
      </button>
      <button
        onClick={() => onDelete(session.id)}
        className={`${trailing} grid ${size} shrink-0 place-items-center rounded-lg text-white/35 transition hover:bg-rose-500/16 hover:text-rose-200`}
        title="Hapus session"
      >
        <Trash2 className="size-3.5" />
      </button>
    </>
  );
}

/** Sidebar riwayat chat (tombol History). */
export function SessionSidebar({
  sessions,
  activeId,
  onNewChat,
  ...actions
}: SessionActions & { sessions: AssistantSession[]; activeId: string | null; onNewChat: () => void }) {
  return (
    <div className="flex w-56 flex-col border-r border-white/10 bg-black/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-white/50">Chat History</span>
        <button onClick={onNewChat} className="grid size-6 place-items-center rounded-lg bg-white/10 text-white/70 hover:bg-white/20" title="New chat">
          <Plus className="size-4" />
        </button>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`group flex w-full items-center rounded-xl text-xs transition ${activeId === s.id ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/10"}`}
          >
            <button onClick={() => actions.onOpen(s.id)} className="min-w-0 flex-1 px-3 py-2 text-left">
              <div className="flex items-center gap-2">
                <MessageSquareMore className="size-3.5 shrink-0" />
                <span className="truncate">{s.title || "Chat session"}</span>
              </div>
              <div className="mt-0.5 text-[10px] text-white/35">
                {new Date(s.updated_at).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
              </div>
            </button>
            <SessionRowActions session={s} onRename={actions.onRename} onDelete={actions.onDelete} size="size-7" trailing="mr-1" />
          </div>
        ))}
        {sessions.length === 0 && <div className="px-2 py-4 text-center text-[10px] text-white/30">Belum ada riwayat chat</div>}
      </div>
    </div>
  );
}

/** Daftar sesi sebelumnya di halaman awal Do. */
export function PreviousSessions({ sessions, ...actions }: SessionActions & { sessions: AssistantSession[] }) {
  if (sessions.length === 0) {
    return <p className="mt-4 text-xs text-white/30">No previous sessions found. Start a new chat above.</p>;
  }
  return (
    <div className="mt-8 w-full max-w-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-white/40">Previous Sessions</span>
      </div>
      <div className="space-y-1">
        {sessions.map((s) => (
          <div key={s.id} className="flex w-full items-center rounded-xl bg-white/5 text-left text-xs text-white/60 transition hover:bg-white/10">
            <button onClick={() => actions.onOpen(s.id)} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left">
              <MessageSquareMore className="size-3.5 shrink-0 text-white/40" />
              <div className="min-w-0 flex-1">
                <div className="truncate">{s.title || "Chat session"}</div>
                <div className="mt-0.5 text-[10px] text-white/30">
                  {new Date(s.updated_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })} ·{" "}
                  {new Date(s.updated_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
              <ChevronRight className="size-3 text-white/30" />
            </button>
            <SessionRowActions session={s} onRename={actions.onRename} onDelete={actions.onDelete} size="size-8" trailing="mr-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
