/** Klien API kalender event (/api/events): kalender gabungan, bentrok, tautan, checklist, langganan ICS. */

export type EntryKind = "crm_event" | "site_event" | "class" | "pt";

export interface CalendarEntry {
  kind: EntryKind;
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  branch_id: string | null;
  branch_name: string | null;
  timezone: string;
  area: string | null;
  coach_id: string | null;
  coach_name: string | null;
  status: string;
  updated_at: string;
  crm_event_id: string | null;
  site_event_id: string | null;
  organiser_user_id: string | null;
  capacity: number | null;
  confirmed: number | null;
}

export interface Clash {
  reason: "room" | "coach" | "branch";
  kind: EntryKind;
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  area: string | null;
  coach_name: string | null;
  message: string;
}

export interface Option {
  id: string;
  name: string;
  timezone?: string;
}

export interface CalendarOptions {
  branches: Option[];
  coaches: Option[];
  staff: Option[];
  areas: string[];
  task_kinds: TaskKind[];
}

export type TaskKind = "venue" | "sponsor" | "promo" | "equipment" | "other";

export interface EventTask {
  id: string;
  kind: TaskKind;
  title: string;
  assignee_user_id: string | null;
  assignee_name: string | null;
  due_at: string | null;
  done_at: string | null;
  created_at: string;
}

export interface TaskInput {
  kind: TaskKind;
  title: string;
  assignee_user_id: string | null;
  due_at: string | null;
}

export interface EventRef {
  id: string;
  title: string;
  starts_at: string;
  status: string;
}

export interface Feed {
  id: string;
  branch_id: string | null;
  branch_name: string | null;
  label: string;
  created_at: string;
}

export interface Override {
  id: string;
  user_id: string | null;
  user_name: string | null;
  reason: string;
  clashes: Clash[];
  created_at: string;
}

export type EventSource = "crm" | "site";

/** Fields the CRM and site event forms share with the calendar. */
export interface PlaceFields {
  branch_id: string | null;
  area: string | null;
  coach_id: string | null;
  organiser_user_id: string | null;
}

export const EMPTY_PLACE: PlaceFields = { branch_id: null, area: null, coach_id: null, organiser_user_id: null };

export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  venue: "Venue",
  sponsor: "Sponsor",
  promo: "Promo",
  equipment: "Peralatan",
  other: "Lainnya",
};

export const KIND_LABEL: Record<EntryKind, string> = {
  crm_event: "Event member",
  site_event: "Event situs",
  class: "Kelas",
  pt: "PT",
};

/** Satu kali simpan ditolak karena bentrok: klien menawarkan "tetap simpan". */
export class EventConflictError extends Error {
  readonly blocking: Clash[];
  readonly warnings: Clash[];
  constructor(message: string, blocking: Clash[], warnings: Clash[]) {
    super(message);
    this.name = "EventConflictError";
    this.blocking = blocking;
    this.warnings = warnings;
  }
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
  code?: string;
  params?: { blocking?: Clash[]; warnings?: Clash[] };
}

/** Membaca amplop API; 409 berkode event_conflict menjadi EventConflictError. */
export async function parseEnvelope<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (res.ok && json.success !== false) return json.data as T;
  const message = json.error || `Permintaan gagal (${res.status})`;
  if (res.status === 409 && json.code === "event_conflict") {
    throw new EventConflictError(message, json.params?.blocking ?? [], json.params?.warnings ?? []);
  }
  throw new Error(message);
}

const call = <T>(url: string, init?: RequestInit) =>
  fetch(url, { cache: "no-store", ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined }).then(
    (res) => parseEnvelope<T>(res)
  );
const send = <T>(url: string, body: unknown, method = "POST") => call<T>(url, { method, body: JSON.stringify(body) });

export interface CalendarQuery {
  from: string;
  to: string;
  branch_id?: string | null;
  area?: string | null;
  kinds?: EntryKind[];
}

function qs(params: Record<string, string | null | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  return q.toString();
}

export const eventsApi = {
  calendar: (q: CalendarQuery) =>
    call<CalendarEntry[]>(
      `/api/events/calendar?${qs({ from: q.from, to: q.to, branch_id: q.branch_id, area: q.area, kinds: q.kinds?.join(",") })}`
    ),
  options: () => call<CalendarOptions>("/api/events/options"),
  overrides: (source: EventSource, eventId: string) =>
    call<Override[]>(`/api/events/overrides?${qs({ source, event_id: eventId })}`),
  exportCsvUrl: (month: string, branchId: string | null) => `/api/events/export.csv?${qs({ month, branch_id: branchId })}`,

  linkCandidates: (source: EventSource) => call<EventRef[]>(`/api/events/link/candidates?source=${source}`),
  link: (crmEventId: string, siteEventId: string) =>
    send<{ crm_event_id: string; site_event_id: string }>("/api/events/link", { crm_event_id: crmEventId, site_event_id: siteEventId }),
  unlink: (crmEventId: string) => call<{ crm_event_id: string }>(`/api/events/link/${crmEventId}`, { method: "DELETE" }),
  publishToSite: (crmEventId: string) =>
    send<{ crm_event_id: string; site_event_id: string }>("/api/events/link/publish", { crm_event_id: crmEventId }),

  tasks: (source: EventSource, eventId: string) => call<EventTask[]>(`/api/events/tasks?${qs({ source, event_id: eventId })}`),
  addTask: (source: EventSource, eventId: string, input: TaskInput) =>
    send<EventTask>("/api/events/tasks", { source, event_id: eventId, ...input }),
  patchTask: (id: string, patch: Partial<TaskInput> & { done?: boolean }) => send<EventTask>(`/api/events/tasks/${id}`, patch, "PATCH"),
  removeTask: (id: string) => call<{ id: string }>(`/api/events/tasks/${id}`, { method: "DELETE" }),

  feeds: () => call<Feed[]>("/api/events/feeds"),
  createFeed: (branchId: string | null, label: string) => send<{ id: string; url: string }>("/api/events/feeds", { branch_id: branchId, label }),
  revokeFeed: (id: string) => call<{ id: string }>(`/api/events/feeds/${id}`, { method: "DELETE" }),
};

export const EVENTS_KEYS = {
  calendar: ["events", "calendar"] as const,
  options: ["events", "options"] as const,
  tasks: (source: EventSource, id: string) => ["events", "tasks", source, id] as const,
  feeds: ["events", "feeds"] as const,
  candidates: (source: EventSource) => ["events", "candidates", source] as const,
};
