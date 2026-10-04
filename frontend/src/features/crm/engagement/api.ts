/** Klien API CRM → Engagement (pengumuman, event, challenge, check-in). */

export interface Announcement {
  id: string;
  title: string;
  body: string;
  kind: "announcement" | "promo";
  audience: AudienceInput;
  recipient_count: number;
  read_count: number;
  sent_at: string | null;
  image_url: string | null;
  link_url: string | null;
}

export interface AudienceInput {
  tier_codes?: string[];
  min_visits?: number;
  inactive_days?: number;
}

export interface CrmEvent {
  id: string;
  title: string;
  description: string;
  host_name: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  price_idr: number;
  booking_closes_hours: number;
  cancel_deadline_hours: number;
  status: "draft" | "published" | "cancelled";
  confirmed_count: number;
  waitlist_count: number;
  attended_count: number;
}

export type EventInput = Omit<CrmEvent, "id" | "status" | "confirmed_count" | "waitlist_count" | "attended_count"> & {
  id?: string;
  status: "draft" | "published";
};

export interface EventBooking {
  id: string;
  status: "confirmed" | "waitlist" | "cancelled" | "attended" | "no_show";
  waitlist_position: number | null;
  late_cancel: boolean;
  created_at: string;
  name: string | null;
  phone: string;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  metric: "visits" | "spend";
  target: number;
  starts_at: string;
  ends_at: string;
  reward_xp: number;
  reward_ark_idr: number;
  is_active: boolean;
  participant_count: number;
  completed_count: number;
}

export type ChallengeInput = Omit<Challenge, "id" | "participant_count" | "completed_count"> & { id?: string };

export interface ChallengeParticipant {
  customer_id: string;
  name: string | null;
  phone: string;
  joined_at: string;
  rewarded_at: string | null;
  value: number;
  pct: number;
  completed: boolean;
}

export interface CheckinLog {
  id: string;
  decision: "accepted" | "denied";
  reason: "not_found" | "expired" | "consumed" | null;
  created_at: string;
  member_name: string | null;
  member_phone: string | null;
  cashier_name: string | null;
}

export interface Tier {
  code: string;
  name: string;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || "Permintaan gagal");
  return json.data as T;
}

const post = <T>(url: string, body: unknown) => call<T>(url, { method: "POST", body: JSON.stringify(body) });

export const engagementApi = {
  tiers: () => call<Tier[]>("/api/crm/tiers"),

  announcements: () => call<Announcement[]>("/api/crm/engagement/announcements"),
  previewAudience: (audience: AudienceInput) =>
    post<{ recipients: number }>("/api/crm/engagement/announcements", {
      title: "pratinjau",
      body: "pratinjau",
      kind: "announcement",
      audience,
      preview: true,
    }),
  sendAnnouncement: (input: {
    title: string;
    body: string;
    kind: Announcement["kind"];
    audience: AudienceInput;
    image_url?: string | null;
    link_url?: string | null;
  }) =>
    post<{ id: string; recipients: number }>("/api/crm/engagement/announcements", input),

  events: () => call<CrmEvent[]>("/api/crm/engagement/events"),
  saveEvent: (input: EventInput) => post<{ id: string }>("/api/crm/engagement/events", input),
  cancelEvent: (id: string) =>
    call<{ notified: number }>(`/api/crm/engagement/events?id=${id}`, { method: "DELETE" }),
  bookings: (eventId: string) => call<EventBooking[]>(`/api/crm/engagement/events/bookings?event_id=${eventId}`),
  changeBooking: (bookingId: string, status: "attended" | "no_show" | "cancelled") =>
    post<{ lateCancel: boolean }>("/api/crm/engagement/events/bookings", { booking_id: bookingId, status }),

  challenges: () => call<Challenge[]>("/api/crm/engagement/challenges"),
  challengeDetail: (id: string) =>
    call<{ challenge: Challenge; participants: ChallengeParticipant[] }>(`/api/crm/engagement/challenges?id=${id}`),
  saveChallenge: (input: ChallengeInput) => post<{ id: string }>("/api/crm/engagement/challenges", input),

  checkins: () =>
    call<{ checkins: CheckinLog[]; today: { accepted: number; denied: number; members: number } }>(
      "/api/crm/engagement/checkins"
    ),
};

/* ── Format ──────────────────────────────────────────────────────────── */

export const angka = (n: number) => Number(n || 0).toLocaleString("id-ID");
export const rupiah = (n: number) => `Rp ${angka(n)}`;

export { formatWib as waktu } from "@/lib/crm/engagement/rules";

/** ISO → nilai <input type="datetime-local"> (waktu lokal browser). */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Nilai datetime-local → ISO dengan offset, sesuai skema API. */
export const fromLocalInput = (value: string) => new Date(value).toISOString();
