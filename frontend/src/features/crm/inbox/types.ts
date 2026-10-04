export type ConversationStatus = "open" | "in_progress" | "waiting_customer" | "resolved";

export type CsChannel = "whatsapp" | "instagram";

export const CHANNEL_LABELS: Record<CsChannel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
};

export type InboxConversation = {
  id: string;
  phone: string | null;
  channel: CsChannel;
  external_id: string;
  display_name: string | null;
  status: ConversationStatus;
  is_complaint?: boolean;
  category?: "produk" | "layanan" | "pembayaran" | "lainnya" | null;
  priority?: "low" | "normal" | "high" | "urgent";
  awaiting_since?: string | null;
  first_response_seconds?: number | null;
  resolution_seconds?: number | null;
  sla_response_breached?: boolean;
  escalated_at?: string | null;
  csat_score?: number | null;
  assigned_user_id: string | null;
  assigned_name: string | null;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  customer_id: string | null;
  customer_name: string | null;
  membership_tier: string | null;
  member_type: string | null;
};

export type InboxMessage = {
  id: string;
  direction: "in" | "out";
  message_type: string;
  body: string | null;
  media_type: string | null;
  status: string;
  error_reason: string | null;
  wa_from_me: boolean;
  created_at: string;
  sent_by_name: string | null;
};

export type MemberContext = {
  id: string;
  name: string | null;
  phone: string | null;
  member_type: string | null;
  visit_count: number;
  total_xp: number;
  ark_coin_balance: number;
  tier_name: string | null;
  recent_orders: {
    id: string;
    order_number: string | null;
    total_amount: number;
    payment_method: string | null;
    status: string;
    created_at: string;
  }[];
  recent_redemptions: {
    redemption_number: string;
    status: string;
    requested_at: string;
    reward_name: string;
  }[];
};

export type ReplyTemplate = {
  id: string;
  title: string;
  body: string;
  is_active: boolean;
};

export const STATUS_LABELS: Record<ConversationStatus, string> = {
  open: "Baru",
  in_progress: "Ditangani",
  waiting_customer: "Tunggu customer",
  resolved: "Selesai",
};

export const STATUS_STYLES: Record<ConversationStatus, string> = {
  open: "bg-amber-50 text-amber-700 border-amber-200",
  in_progress: "bg-sky-50 text-sky-700 border-sky-200",
  waiting_customer: "bg-violet-50 text-violet-700 border-violet-200",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export type InternalNote = {
  id: string;
  body: string;
  created_at: string;
  author_name: string | null;
};
