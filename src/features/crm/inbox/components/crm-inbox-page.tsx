"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, Inbox, Loader2, MessageCircle, WifiOff } from "lucide-react";
import type { ConversationAction, InboxFilters, InboxTotals } from "../api";
import type { InboxConversation } from "../types";
import {
  clearUnreadInLists,
  useConversationAction,
  useConversationDetail,
  useConversations,
  useGatewayDown,
  useReplyTemplates,
} from "../queries";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ChatPanel } from "./chat-panel";
import { ConversationList } from "./conversation-list";
import { MemberContextPanel } from "./member-context-panel";
import { ComplaintPanel } from "./complaint-panel";

/**
 * EPIC-012 Fase C — Inbox WhatsApp CS: daftar percakapan, thread chat, dan
 * konteks member. Daftar & thread di-polling tiap 5 detik (lihat queries.ts).
 */

const INITIAL_FILTERS: InboxFilters = { status: "all", assigned: "all", channel: "all", search: "" };

export function CrmInboxPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const debouncedFilters = useDebouncedValue(filters, 250);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listQuery = useConversations(debouncedFilters);
  const detailQuery = useConversationDetail(selectedId);
  const templates = useReplyTemplates().data ?? [];
  const gatewayDown = useGatewayDown().data ?? false;
  const actionMutation = useConversationAction();
  const markReadMutation = useConversationAction();

  const conversations = listQuery.data?.conversations ?? [];
  const totals = listQuery.data?.totals ?? null;
  const detail = detailQuery.data ?? null;
  const failure = actionMutation.error ?? listQuery.error ?? detailQuery.error;
  const error = failure instanceof Error ? failure.message : null;
  const activeConversation =
    detail?.conversation ?? conversations.find((item) => item.id === selectedId) ?? null;

  function selectConversation(conversation: InboxConversation) {
    setSelectedId(conversation.id);
    if (conversation.unread_count > 0) {
      clearUnreadInLists(queryClient, conversation.id);
      markReadMutation.mutate({ id: conversation.id, payload: { action: "mark_read" } });
    }
  }

  /** true bila sukses; gagal tampil lewat banner error. */
  async function runAction(payload: ConversationAction): Promise<boolean> {
    if (!selectedId) return false;
    try {
      await actionMutation.mutateAsync({ id: selectedId, payload });
      return true;
    } catch {
      return false;
    }
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <InboxHeader totals={totals} gatewayDown={gatewayDown} />

      {error && <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[320px_1fr_280px]">
        <div
          className={`flex min-h-0 flex-col border-r border-slate-200 bg-white ${selectedId ? "hidden lg:flex" : "flex"}`}
        >
          <ConversationList
            filters={filters}
            onFiltersChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
            conversations={conversations}
            loading={listQuery.isLoading}
            selectedId={selectedId}
            onSelect={selectConversation}
          />
        </div>

        {/* Kolom 2 — chat */}
        <div className={`min-h-0 ${selectedId ? "block" : "hidden lg:block"}`}>
          {activeConversation && detail ? (
            <div className="flex h-full flex-col">
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="flex items-center gap-1 border-b border-slate-200 bg-white px-4 py-2 text-xs text-slate-500 lg:hidden"
              >
                <ArrowLeft className="size-3.5" /> Kembali ke daftar
              </button>
              <div className="min-h-0 flex-1">
                <ChatPanel
                  key={activeConversation.id}
                  conversation={activeConversation}
                  messages={detail.messages}
                  templates={templates}
                  busy={actionMutation.isPending && actionMutation.variables?.payload.action === "reply"}
                  onReply={(message) => runAction({ action: "reply", message })}
                  onAction={runAction}
                />
              </div>
            </div>
          ) : selectedId ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-6 animate-spin text-slate-400" />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-400">
              <MessageCircle className="size-10" />
              Pilih percakapan untuk mulai membalas.
            </div>
          )}
        </div>

        {/* Kolom 3 — konteks member */}
        <div className="hidden min-h-0 overflow-y-auto border-l border-slate-200 bg-white lg:block">
          {detail ? (
            <>
              <MemberContextPanel member={detail.member} />
              <ComplaintPanel
                conversation={detail.conversation}
                notes={detail.notes ?? []}
                onSetComplaint={(payload) => runAction({ action: "set_complaint", ...payload })}
                onAddNote={(body) => runAction({ action: "add_note", body })}
              />
            </>
          ) : (
            <div className="p-6 text-center text-xs text-slate-400">Profil member tampil di sini.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function InboxHeader({ totals, gatewayDown }: { totals: InboxTotals | null; gatewayDown: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
      <div>
        <Link
          href="/dashboard/crm"
          className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="size-3.5" /> CRM Dashboard
        </Link>
        <h1 className="mt-0.5 flex items-center gap-2 text-lg font-semibold text-slate-950">
          <Inbox className="size-5 text-violet-600" />
          Inbox WhatsApp
          {totals && totals.total_unread > 0 && (
            <span className="rounded-full bg-violet-600 px-2 py-0.5 text-xs font-semibold text-white">
              {totals.total_unread} belum dibaca
            </span>
          )}
          {totals && (totals.total_complaints ?? 0) > 0 && (
            <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">
              {totals.total_complaints} komplain
            </span>
          )}
          {totals && (totals.total_instagram ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-pink-200 bg-pink-50 px-2 py-0.5 text-xs font-medium text-pink-700">
              <Camera className="size-3" />
              {totals.total_instagram}
            </span>
          )}
          {totals && (totals.total_breached ?? 0) > 0 && (
            <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
              {totals.total_breached} lewat SLA
            </span>
          )}
        </h1>
      </div>
      <Link
        href="/dashboard/settings/instagram"
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
      >
        <Camera className="size-3.5 text-pink-600" /> Pengaturan Instagram
      </Link>
      {gatewayDown && (
        <div className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
          <WifiOff className="size-3.5" />
          Gateway WhatsApp tidak terhubung — pesan baru tidak masuk.
          <Link href="/dashboard/settings/wa-gateway" className="underline">
            Periksa
          </Link>
        </div>
      )}
    </div>
  );
}
