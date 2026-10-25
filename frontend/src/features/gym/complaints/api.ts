/** Klien API Gym → Keluhan: tiket, riwayat, pengaturan SLA, kategori, laporan. */
import { call, send, remove } from "../shared";

export type ComplaintStatus = "received" | "in_progress" | "resolved" | "confirmed" | "reopened";
export type ComplaintPriority = "low" | "normal" | "high" | "urgent";
export type ComplaintSource = "wa_inbox" | "front_desk" | "member_app" | "staff";

export const STATUS_LABEL: Record<ComplaintStatus, string> = {
  received: "Diterima",
  in_progress: "Ditangani",
  resolved: "Selesai",
  confirmed: "Dikonfirmasi member",
  reopened: "Dibuka lagi",
};

export const STATUS_VARIANT: Record<ComplaintStatus, "info" | "warning" | "success" | "muted" | "destructive"> = {
  received: "info",
  in_progress: "warning",
  resolved: "success",
  confirmed: "muted",
  reopened: "destructive",
};

/** Label tombol pindah status. */
export const MOVE_LABEL: Record<ComplaintStatus, string> = {
  received: "Diterima",
  in_progress: "Mulai tangani",
  resolved: "Tandai selesai",
  confirmed: "Konfirmasi atas nama member",
  reopened: "Buka lagi",
};

export const PRIORITIES: ComplaintPriority[] = ["low", "normal", "high", "urgent"];
export const PRIORITY_LABEL: Record<ComplaintPriority, string> = { low: "Rendah", normal: "Normal", high: "Tinggi", urgent: "Mendesak" };

export const SOURCE_LABEL: Record<ComplaintSource, string> = {
  wa_inbox: "WhatsApp inbox",
  front_desk: "Front desk",
  member_app: "Member app",
  staff: "Staf",
};

export interface Ticket {
  id: string;
  code: string;
  source: ComplaintSource;
  category: string;
  category_label: string;
  priority: ComplaintPriority;
  status: ComplaintStatus;
  title: string;
  description: string | null;
  customer_id: string | null;
  member_name: string | null;
  member_phone: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  coach_id: string | null;
  coach_name: string | null;
  session_id: string | null;
  session_name: string | null;
  session_starts_at: string | null;
  branch_id: string | null;
  branch_name: string | null;
  timezone: string;
  conversation_id: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  respond_by: string;
  resolve_by: string;
  first_response_at: string | null;
  resolved_at: string | null;
  confirmed_at: string | null;
  reopen_count: number;
  overdue: boolean;
  escalated: boolean;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketEvent {
  id: string;
  kind: "created" | "status" | "assign" | "note" | "reply" | "updated" | "escalated";
  from_status: ComplaintStatus | null;
  to_status: ComplaintStatus | null;
  body: string | null;
  is_public: boolean;
  actor_name: string | null;
  by_member: boolean;
  created_at: string;
}

export interface TicketDetail extends Ticket {
  events: TicketEvent[];
  next_statuses: ComplaintStatus[];
}

export interface TicketPage {
  rows: Ticket[];
  total: number;
  counts: Partial<Record<ComplaintStatus, number>>;
}

export interface Category {
  code: string;
  label: string;
  sort_order: number;
  is_active: boolean;
}

export interface Ref {
  id: string;
  name: string;
  hint?: string | null;
}

export interface Options {
  categories: Category[];
  staff: Ref[];
  coach_users: Ref[];
  coaches: Ref[];
  branches: Ref[];
}

export interface MemberClass {
  session_id: string;
  name: string;
  starts_at: string;
  timezone: string;
  coach_id: string | null;
  coach_name: string | null;
}

export interface SlaRule {
  respond_hours: number;
  resolve_hours: number;
  business_hours: boolean;
}

export interface Settings {
  branch_id: string | null;
  inherited: boolean;
  sla: Record<ComplaintPriority, SlaRule>;
  work_start: string;
  work_end: string;
  escalation_user_id: string | null;
  escalation_user_name: string | null;
  escalation_phone: string | null;
}

export interface NewTicket {
  source?: "front_desk" | "staff";
  category: string;
  priority?: ComplaintPriority;
  title?: string;
  description?: string;
  customer_id?: string | null;
  contact_name?: string;
  contact_phone?: string;
  coach_id?: string | null;
  session_id?: string | null;
  branch_id?: string | null;
  owner_user_id?: string | null;
}

export interface Metrics {
  key: string;
  label: string;
  total: number;
  open: number;
  resolved: number;
  confirmed: number;
  reopened: number;
  escalated: number;
  reopened_rate: number | null;
  respond_median_h: number | null;
  resolve_median_h: number | null;
  resolve_p90_h: number | null;
}

export interface CoachMetrics extends Metrics {
  attendees: number;
  rate_per_100: number | null;
}

export interface Report {
  from: string;
  to: string;
  summary: Metrics;
  by_category: Metrics[];
  by_source: Metrics[];
  by_branch: Metrics[];
  by_coach: CoachMetrics[];
}

export interface ConversationView {
  ticket: Ticket | null;
  suggestion: {
    category: string;
    priority: ComplaintPriority;
    description: string | null;
    customer_id: string | null;
    contact_name: string | null;
    contact_phone: string | null;
    is_complaint: boolean;
    sla_breached: boolean;
  };
}

export interface CoachTickets {
  coach: { id: string; name: string } | null;
  tickets: Pick<
    Ticket,
    "id" | "code" | "category_label" | "priority" | "status" | "title" | "description" | "session_name" | "session_starts_at" | "timezone" | "created_at"
  >[];
}

export const PAGE_SIZE = 25;

export interface ListFilters {
  status: string;
  category: string;
  priority: string;
  source: string;
  branch_id: string;
  owner: string;
  overdue: boolean;
  q: string;
  customer_id?: string;
}

export const EMPTY_FILTERS: ListFilters = {
  status: "active",
  category: "",
  priority: "",
  source: "",
  branch_id: "",
  owner: "",
  overdue: false,
  q: "",
};

/** Query string daftar tiket: filter kosong tidak ikut. */
export function listQuery(f: ListFilters, page: number, pageSize = PAGE_SIZE): string {
  const params = new URLSearchParams();
  for (const key of ["status", "category", "priority", "source", "branch_id", "owner", "customer_id"] as const) {
    const v = f[key];
    if (v) params.set(key, v);
  }
  if (f.q.trim()) params.set("q", f.q.trim());
  if (f.overdue) params.set("overdue", "1");
  params.set("limit", String(pageSize));
  params.set("offset", String(page * pageSize));
  return params.toString();
}

/** Nama pelapor: member, lalu kontak, lalu "-". */
export function reporterName(t: Pick<Ticket, "member_name" | "contact_name" | "contact_phone">): string {
  return t.member_name ?? t.contact_name ?? t.contact_phone ?? "-";
}

/**
 * Batas waktu yang sedang berjalan: respons sebelum ada respons pertama,
 * lalu penyelesaian. null untuk tiket yang sudah selesai.
 */
export function activeDeadline(t: Pick<Ticket, "status" | "first_response_at" | "respond_by" | "resolve_by">): {
  kind: "respond" | "resolve";
  at: string;
} | null {
  if (t.status === "resolved" || t.status === "confirmed") return null;
  if (!t.first_response_at) return { kind: "respond", at: t.respond_by };
  return { kind: "resolve", at: t.resolve_by };
}

/** "3 jam lagi", "lewat 2 jam", "lewat 1 hari": sisa waktu ke batas. */
export function deadlineText(at: string, now: Date): string {
  const minutes = Math.round((new Date(at).getTime() - now.getTime()) / 60_000);
  const abs = Math.abs(minutes);
  const span = abs < 60 ? `${Math.max(1, abs)} menit` : abs < 48 * 60 ? `${Math.round(abs / 60)} jam` : `${Math.round(abs / 1440)} hari`;
  return minutes >= 0 ? `${span} lagi` : `lewat ${span}`;
}

/** Jam ke teks laporan: "45 mnt", "5,5 jam", "2,1 hari"; null jadi "-". */
export function hoursText(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return "-";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} mnt`;
  if (hours < 48) return `${hours.toLocaleString("id-ID", { maximumFractionDigits: 1 })} jam`;
  return `${(hours / 24).toLocaleString("id-ID", { maximumFractionDigits: 1 })} hari`;
}

/** Rasio 0..1 sebagai persen satu desimal; null jadi "-". */
export function rateText(ratio: number | null): string {
  return ratio === null ? "-" : `${(Math.round(ratio * 1000) / 10).toLocaleString("id-ID")}%`;
}

export const COMPLAINT_KEYS = {
  all: ["gym-complaints"] as const,
  list: (query: string) => ["gym-complaints", "list", query] as const,
  detail: (id: string) => ["gym-complaints", "detail", id] as const,
  options: ["gym-complaints", "options"] as const,
  memberClasses: (customerId: string) => ["gym-complaints", "member-classes", customerId] as const,
  settings: (branchId: string) => ["gym-complaints", "settings", branchId] as const,
  categories: ["gym-complaints", "categories"] as const,
  report: (query: string) => ["gym-complaints", "report", query] as const,
  conversation: (id: string) => ["gym-complaints", "conversation", id] as const,
  mine: ["gym-complaints", "mine"] as const,
};

const base = "/api/gym/complaints";

export const complaintsApi = {
  list: (query: string) => call<TicketPage>(`${base}?${query}`),
  detail: (id: string) => call<TicketDetail>(`${base}/${id}`),
  create: (input: NewTicket) => send<{ id: string; code: string }>(base, input),
  update: (id: string, patch: Partial<Pick<NewTicket, "category" | "priority" | "title" | "description" | "coach_id" | "session_id" | "branch_id">> & { clear?: string[] }) =>
    send<TicketDetail>(`${base}/${id}`, patch, "PATCH"),
  move: (id: string, status: ComplaintStatus, note: string) => send<TicketDetail>(`${base}/${id}/status`, { status, note }),
  assign: (id: string, userId: string | null) => send<TicketDetail>(`${base}/${id}/assign`, { user_id: userId }),
  note: (id: string, body: string, isPublic: boolean) => send<TicketDetail>(`${base}/${id}/notes`, { body, public: isPublic }),
  remove: (id: string) => remove<{ id: string }>(`${base}/${id}`),
  options: () => call<Options>(`${base}/options`),
  memberClasses: (customerId: string) => call<MemberClass[]>(`${base}/member-classes?customer_id=${encodeURIComponent(customerId)}`),
  settings: (branchId: string) => call<Settings>(`${base}/settings${branchId ? `?branch_id=${encodeURIComponent(branchId)}` : ""}`),
  saveSettings: (input: Omit<Settings, "inherited" | "escalation_user_name"> & { reset?: boolean }) =>
    send<Settings>(`${base}/settings`, input, "PUT"),
  categories: () => call<Category[]>(`${base}/categories`),
  saveCategories: (categories: Category[]) => send<Category[]>(`${base}/categories`, { categories }, "PUT"),
  report: (query: string) => call<Report>(`${base}/report?${query}`),
  conversation: (id: string) => call<ConversationView>(`${base}/conversations/${id}/ticket`),
  fromConversation: (id: string, input: Partial<NewTicket>) =>
    send<{ id: string; code: string }>(`${base}/conversations/${id}/ticket`, input),
  mine: () => call<CoachTickets>("/api/gym/my-classes/complaints"),
};

export const ticketHref = (id: string) => `/dashboard/gym/complaints/${id}`;
