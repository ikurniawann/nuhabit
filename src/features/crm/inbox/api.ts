import type { CsCategory, CsPriority } from "@/lib/crm/cs-rules";
import { parseCrmResponse } from "../http";
import type {
  ConversationStatus,
  InboxConversation,
  InboxMessage,
  InternalNote,
  MemberContext,
  ReplyTemplate,
} from "./types";

export type InboxFilters = {
  status: string;
  assigned: string;
  channel: string;
  search: string;
};

export type InboxTotals = {
  total_unread: number;
  total_active: number;
  total_breached?: number;
  total_complaints?: number;
  total_whatsapp?: number;
  total_instagram?: number;
};

export type ConversationList = { conversations: InboxConversation[]; totals: InboxTotals | null };

export type ConversationDetail = {
  conversation: InboxConversation;
  messages: InboxMessage[];
  member: MemberContext | null;
  notes: InternalNote[];
};

export type ConversationAction =
  | { action: "reply"; message: string }
  | { action: "mark_read" }
  | { action: "assign_me" }
  | { action: "unassign" }
  | { action: "set_status"; status: ConversationStatus }
  | { action: "set_complaint"; is_complaint: boolean; category?: CsCategory | null; priority?: CsPriority }
  | { action: "add_note"; body: string };

export type ConversationInsight = {
  summary: string;
  topic: string;
  sentiment: "positif" | "netral" | "negatif";
  is_complaint: boolean;
  keywords: string[];
  analyzed_at?: string | null;
};

/** Query string daftar percakapan; filter "all" dan pencarian kosong dihilangkan. */
export function conversationSearchParams(filters: InboxFilters): string {
  const sp = new URLSearchParams();
  if (filters.status !== "all") sp.set("status", filters.status);
  if (filters.assigned !== "all") sp.set("assigned", filters.assigned);
  if (filters.channel !== "all") sp.set("channel", filters.channel);
  if (filters.search.trim()) sp.set("search", filters.search.trim());
  return sp.toString();
}

export async function fetchConversations(filters: InboxFilters): Promise<ConversationList> {
  const response = await fetch(`/api/crm/inbox/conversations?${conversationSearchParams(filters)}`, {
    cache: "no-store",
  });
  const json = await parseCrmResponse<{ data: Partial<ConversationList> }>(response, "Gagal memuat inbox");
  return { conversations: json.data.conversations ?? [], totals: json.data.totals ?? null };
}

export async function fetchConversationDetail(id: string): Promise<ConversationDetail> {
  const response = await fetch(`/api/crm/inbox/conversations/${id}`, { cache: "no-store" });
  const json = await parseCrmResponse<{ data: ConversationDetail }>(response, "Gagal memuat percakapan");
  return json.data;
}

export async function postConversationAction(
  id: string,
  payload: ConversationAction,
  fallbackError: string
): Promise<void> {
  const response = await fetch(`/api/crm/inbox/conversations/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await parseCrmResponse(response, fallbackError);
}

/** Template balasan; gagal dimuat = daftar kosong (fitur opsional). */
export async function fetchReplyTemplates(): Promise<ReplyTemplate[]> {
  try {
    const response = await fetch("/api/crm/inbox/templates", { cache: "no-store" });
    const json = await response.json();
    return json.data ?? [];
  } catch {
    return [];
  }
}

/** true bila gateway WhatsApp diketahui mati; error/tanpa akses = tidak ditandai. */
export async function fetchGatewayDown(): Promise<boolean> {
  try {
    const response = await fetch("/api/settings/wa-gateway", { cache: "no-store" });
    if (!response.ok) return false;
    const json = await response.json();
    return Boolean(json?.data && (json.data.reachable === false || json.data.status?.connected === false));
  } catch {
    return false;
  }
}

export async function fetchConversationInsight(conversationId: string): Promise<ConversationInsight | null> {
  const response = await fetch(`/api/crm/inbox/analytics?conversation_id=${encodeURIComponent(conversationId)}`, {
    cache: "no-store",
  });
  const json = await parseCrmResponse<{ data: { insight: ConversationInsight | null } }>(
    response,
    "Gagal memuat ringkasan"
  );
  return json.data.insight ?? null;
}

/**
 * Analisa ulang (force) walau cache masih sah — tombol ini ditekan justru ketika
 * agent ingin ringkasan terbaru. `empty` = belum ada pesan teks untuk diringkas.
 */
export async function analyzeConversation(
  conversationId: string
): Promise<{ insight: ConversationInsight | null; empty: boolean }> {
  const response = await fetch("/api/crm/inbox/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_id: conversationId, force: true }),
  });
  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.data?.error || json.error || "Gagal meringkas percakapan");
  }
  return { insight: json.data.insight ?? null, empty: json.data.status === "empty" };
}
