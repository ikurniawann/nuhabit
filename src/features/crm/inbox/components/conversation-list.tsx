"use client";

import { Camera, Loader2, MessageCircle, Search } from "lucide-react";
import type { InboxFilters } from "../api";
import type { InboxConversation } from "../types";
import { STATUS_LABELS, STATUS_STYLES } from "../types";
import { conversationTitle, relativeTime } from "../inbox-format";

/** Penanda kanal — dibedakan warna agar terbaca sekilas di daftar. */
export function ChannelIcon({ channel }: { channel: "whatsapp" | "instagram" }) {
  if (channel === "instagram") {
    // lucide-react sudah mencabut ikon brand; Camera dipakai sebagai penanda
    // Instagram, dibedakan lewat warna pink brand-nya.
    return <Camera aria-label="Instagram" className="size-3.5 shrink-0 text-pink-600" />;
  }
  return <MessageCircle aria-label="WhatsApp" className="size-3.5 shrink-0 text-emerald-600" />;
}

/** Kolom 1 — filter + daftar percakapan. */
export function ConversationList({
  filters,
  onFiltersChange,
  conversations,
  loading,
  selectedId,
  onSelect,
}: {
  filters: InboxFilters;
  onFiltersChange: (patch: Partial<InboxFilters>) => void;
  conversations: InboxConversation[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (conversation: InboxConversation) => void;
}) {
  return (
    <>
      <div className="space-y-2 border-b border-slate-200 p-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={filters.search}
            onChange={(event) => onFiltersChange({ search: event.target.value })}
            placeholder="Cari nomor atau nama..."
            className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          />
        </label>
        <select
          value={filters.channel}
          onChange={(event) => onFiltersChange({ channel: event.target.value })}
          className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs outline-none"
        >
          <option value="all">Semua kanal</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="instagram">Instagram</option>
        </select>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={filters.status}
            onChange={(event) => onFiltersChange({ status: event.target.value })}
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs outline-none"
          >
            <option value="all">Semua status</option>
            <option value="open">Baru</option>
            <option value="in_progress">Ditangani</option>
            <option value="waiting_customer">Tunggu customer</option>
            <option value="resolved">Selesai</option>
          </select>
          <select
            value={filters.assigned}
            onChange={(event) => onFiltersChange({ assigned: event.target.value })}
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs outline-none"
          >
            <option value="all">Semua agent</option>
            <option value="me">Saya tangani</option>
            <option value="unassigned">Belum ditangani</option>
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-slate-400" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-slate-400">
            <MessageCircle className="size-7" />
            Belum ada percakapan. Pesan WhatsApp masuk akan muncul di sini.
          </div>
        ) : (
          conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => onSelect(conversation)}
              className={`block w-full border-b border-slate-100 px-3 py-2.5 text-left transition hover:bg-slate-50 ${
                selectedId === conversation.id ? "bg-violet-50/70" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <ChannelIcon channel={conversation.channel} />
                  <span className="truncate text-sm font-medium text-slate-900">{conversationTitle(conversation)}</span>
                </span>
                <span className="shrink-0 text-[10px] text-slate-400">{relativeTime(conversation.last_message_at)}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-slate-500">{conversation.last_message_preview || "—"}</span>
                {conversation.unread_count > 0 && (
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-violet-600 text-[10px] font-bold text-white">
                    {conversation.unread_count > 9 ? "9+" : conversation.unread_count}
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <span className={`rounded-full border px-1.5 py-px text-[10px] font-medium ${STATUS_STYLES[conversation.status]}`}>
                  {STATUS_LABELS[conversation.status]}
                </span>
                {conversation.is_complaint && (
                  <span className="rounded-full border border-orange-200 bg-orange-50 px-1.5 py-px text-[10px] font-medium text-orange-700">
                    Komplain
                  </span>
                )}
                {conversation.sla_response_breached && (
                  <span className="rounded-full border border-red-200 bg-red-50 px-1.5 py-px text-[10px] font-semibold text-red-700">
                    Lewat SLA
                  </span>
                )}
                {conversation.assigned_name && (
                  <span className="truncate text-[10px] text-slate-400">{conversation.assigned_name}</span>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </>
  );
}
