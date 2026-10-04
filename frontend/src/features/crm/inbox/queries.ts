"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  analyzeConversation,
  fetchConversationDetail,
  fetchConversationInsight,
  fetchConversations,
  fetchGatewayDown,
  fetchReplyTemplates,
  postConversationAction,
  type ConversationAction,
  type ConversationList,
  type InboxFilters,
} from "./api";

/** Inbox di-polling tiap 5 detik (pola halaman gateway). */
export const INBOX_POLL_MS = 5000;

export const inboxQueryKeys = {
  all: ["crm", "inbox"] as const,
  lists: () => ["crm", "inbox", "list"] as const,
  list: (filters: InboxFilters) => ["crm", "inbox", "list", filters] as const,
  detail: (id: string) => ["crm", "inbox", "detail", id] as const,
  templates: ["crm", "inbox", "templates"] as const,
  gateway: ["crm", "inbox", "gateway"] as const,
  insight: (id: string) => ["crm", "inbox", "insight", id] as const,
};

export const useConversations = (filters: InboxFilters) =>
  useQuery({
    queryKey: inboxQueryKeys.list(filters),
    queryFn: () => fetchConversations(filters),
    refetchInterval: INBOX_POLL_MS,
  });

export const useConversationDetail = (id: string | null) =>
  useQuery({
    queryKey: inboxQueryKeys.detail(id ?? ""),
    queryFn: () => fetchConversationDetail(id as string),
    enabled: Boolean(id),
    refetchInterval: INBOX_POLL_MS,
  });

export const useReplyTemplates = () =>
  useQuery({ queryKey: inboxQueryKeys.templates, queryFn: fetchReplyTemplates, staleTime: Infinity });

/** Penanda gateway mati — inbox berhenti menerima tanpa ini. */
export const useGatewayDown = () =>
  useQuery({ queryKey: inboxQueryKeys.gateway, queryFn: fetchGatewayDown, staleTime: Infinity });

const ACTION_ERRORS: Record<ConversationAction["action"], string> = {
  reply: "Gagal mengirim balasan",
  mark_read: "Gagal memproses aksi",
  assign_me: "Gagal memproses aksi",
  unassign: "Gagal memproses aksi",
  set_status: "Gagal memproses aksi",
  set_complaint: "Gagal memproses aksi",
  add_note: "Gagal memproses aksi",
};

/** Aksi pada satu percakapan; sukses → muat ulang detail dan daftar. */
export function useConversationAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ConversationAction }) =>
      postConversationAction(id, payload, ACTION_ERRORS[payload.action]),
    onSuccess: (_data, { id }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: inboxQueryKeys.detail(id) }),
        queryClient.invalidateQueries({ queryKey: inboxQueryKeys.lists() }),
      ]),
  });
}

/** Optimis: hilangkan badge unread percakapan di semua daftar yang tersimpan. */
export function clearUnreadInLists(queryClient: ReturnType<typeof useQueryClient>, id: string) {
  queryClient.setQueriesData<ConversationList>({ queryKey: inboxQueryKeys.lists() }, (current) =>
    current && {
      ...current,
      conversations: current.conversations.map((item) => (item.id === id ? { ...item, unread_count: 0 } : item)),
    }
  );
}

export const useConversationInsight = (conversationId: string) =>
  useQuery({
    queryKey: inboxQueryKeys.insight(conversationId),
    queryFn: () => fetchConversationInsight(conversationId),
  });

export function useAnalyzeConversation(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => analyzeConversation(conversationId),
    onSuccess: ({ insight }) => queryClient.setQueryData(inboxQueryKeys.insight(conversationId), insight),
  });
}
