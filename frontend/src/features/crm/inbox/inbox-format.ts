import { formatDate } from "@/lib/format";
import type { InboxConversation, InboxMessage } from "./types";

/** Nama tampilan percakapan: nama customer, nama profil, lalu nomor/ID kanal. */
export function conversationTitle(
  conversation: Pick<InboxConversation, "customer_name" | "display_name" | "channel" | "external_id">
): string {
  return (
    conversation.customer_name ||
    conversation.display_name ||
    (conversation.channel === "whatsapp" ? `+${conversation.external_id}` : conversation.external_id)
  );
}

/** "baru saja", "5m", "3j", lalu tanggal pendek untuk lebih dari sehari. */
export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}j`;
  return formatDate(iso);
}

/** Pesan dengan label tanggal pada pesan pertama tiap hari (WIB). */
export function withDateSeparators(messages: InboxMessage[]): { message: InboxMessage; dateLabel: string | null }[] {
  let lastDate = "";
  return messages.map((message) => {
    const date = formatDate(message.created_at);
    const dateLabel = date !== lastDate ? date : null;
    lastDate = date;
    return { message, dateLabel };
  });
}
