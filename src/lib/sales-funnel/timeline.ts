/**
 * EPIC-050 Fase 1 (T-1.4) — timeline terpadu satu record.
 *
 * Satu komponen <RecordTimeline> membaca satu endpoint yang menggabungkan
 * beberapa sumber (task/aktivitas, riwayat tahap deal, quotation, invoice,
 * pesan WA, catatan). Fungsi di sini murni: normalisasi + gabung + urut.
 */
import { formatRupiah } from "@/lib/format";

export const TIMELINE_KINDS = [
  "task",
  "activity",
  "stage",
  "quotation",
  "invoice",
  "wa",
  "lead",
  "deal",
  "note",
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export interface TimelineEvent {
  /** unik per sumber: `${kind}:${id}` */
  key: string;
  kind: TimelineKind;
  /** waktu urut (ISO) */
  at: string;
  title: string;
  description?: string | null;
  /** status/label kecil (mis. "done", "open", "draft", "masuk") */
  badge?: string | null;
  actor?: string | null;
  /** tautan detail bila ada */
  href?: string | null;
  /** untuk task: jatuh tempo & status agar UI bisa memberi aksi "selesai" */
  meta?: Record<string, unknown>;
}

export interface TimelineSources {
  tasks?: Array<{
    id: string;
    activity_type: string;
    title: string | null;
    notes: string | null;
    due_at: string | null;
    done_at: string | null;
    status: string;
    priority: string;
    created_at: string;
    owner_name: string | null;
    deal_title?: string | null;
  }>;
  stages?: Array<{
    id: string;
    deal_id: string;
    deal_title: string;
    stage_name: string;
    entered_at: string;
    actor_name?: string | null;
  }>;
  quotations?: Array<{
    id: string;
    deal_id: string;
    quote_number: string;
    status: string;
    total: string | number;
    created_at: string;
  }>;
  invoices?: Array<{
    id: string;
    deal_id: string;
    invoice_number: string;
    label: string | null;
    status: string;
    amount: string | number;
    created_at: string;
  }>;
  waMessages?: Array<{
    id: string;
    direction: string;
    body: string | null;
    status: string | null;
    created_at: string;
    sender_name?: string | null;
  }>;
  leads?: Array<{ id: string; org_name: string; status: string; created_at: string; owner_name?: string | null }>;
  deals?: Array<{ id: string; title: string; stage_name: string; created_at: string; owner_name?: string | null }>;
}


const ACTIVITY_LABEL: Record<string, string> = {
  telepon: "Telepon",
  wa: "WhatsApp",
  meeting: "Meeting",
  catatan: "Catatan",
  tugas: "Task",
  email: "Email",
};

/** Task/aktivitas → satu event; waktu urut = done_at ?? due_at ?? created_at. */
export function normalizeTasks(rows: NonNullable<TimelineSources["tasks"]>): TimelineEvent[] {
  return rows.map((t) => {
    const isTask = t.activity_type === "tugas" || Boolean(t.title);
    return {
      key: `task:${t.id}`,
      kind: isTask ? "task" : "activity",
      at: t.done_at ?? t.due_at ?? t.created_at,
      title: t.title ?? `${ACTIVITY_LABEL[t.activity_type] ?? t.activity_type}${t.deal_title ? ` · ${t.deal_title}` : ""}`,
      description: t.notes,
      badge: t.status,
      actor: t.owner_name,
      meta: { due_at: t.due_at, done_at: t.done_at, status: t.status, priority: t.priority, activity_type: t.activity_type },
    };
  });
}

export function normalizeStages(rows: NonNullable<TimelineSources["stages"]>): TimelineEvent[] {
  return rows.map((s) => ({
    key: `stage:${s.id}`,
    kind: "stage",
    at: s.entered_at,
    title: `Deal "${s.deal_title}" masuk tahap ${s.stage_name}`,
    actor: s.actor_name ?? null,
    href: `/dashboard/sales-funnel/pipeline?deal=${s.deal_id}`,
  }));
}

export function normalizeQuotations(rows: NonNullable<TimelineSources["quotations"]>): TimelineEvent[] {
  return rows.map((q) => ({
    key: `quotation:${q.id}`,
    kind: "quotation",
    at: q.created_at,
    title: `Quotation ${q.quote_number} · ${formatRupiah(q.total)}`,
    badge: q.status,
    href: `/dashboard/sales-funnel/pipeline?deal=${q.deal_id}`,
  }));
}

export function normalizeInvoices(rows: NonNullable<TimelineSources["invoices"]>): TimelineEvent[] {
  return rows.map((i) => ({
    key: `invoice:${i.id}`,
    kind: "invoice",
    at: i.created_at,
    title: `Invoice ${i.invoice_number}${i.label ? ` (${i.label})` : ""} · ${formatRupiah(i.amount)}`,
    badge: i.status,
    href: `/dashboard/sales-funnel/pipeline?deal=${i.deal_id}`,
  }));
}

export function normalizeWaMessages(rows: NonNullable<TimelineSources["waMessages"]>): TimelineEvent[] {
  return rows.map((m) => ({
    key: `wa:${m.id}`,
    kind: "wa",
    at: m.created_at,
    title: m.direction === "inbound" ? "WA masuk" : "WA keluar",
    description: m.body ? m.body.slice(0, 280) : null,
    badge: m.status,
    actor: m.sender_name ?? null,
  }));
}

export function normalizeLeads(rows: NonNullable<TimelineSources["leads"]>): TimelineEvent[] {
  return rows.map((l) => ({
    key: `lead:${l.id}`,
    kind: "lead",
    at: l.created_at,
    title: `Lead dibuat: ${l.org_name}`,
    badge: l.status,
    actor: l.owner_name ?? null,
    href: `/dashboard/sales-funnel/leads/${l.id}`,
  }));
}

export function normalizeDeals(rows: NonNullable<TimelineSources["deals"]>): TimelineEvent[] {
  return rows.map((d) => ({
    key: `deal:${d.id}`,
    kind: "deal",
    at: d.created_at,
    title: `Deal dibuat: ${d.title}`,
    badge: d.stage_name,
    actor: d.owner_name ?? null,
    href: `/dashboard/sales-funnel/pipeline?deal=${d.id}`,
  }));
}

/**
 * Gabungkan semua sumber → urut terbaru dulu, dedup by key, potong `limit`.
 * Event dengan `at` tidak valid diletakkan paling akhir (bukan dibuang).
 */
export function mergeTimeline(sources: TimelineSources, limit = 100): TimelineEvent[] {
  const events: TimelineEvent[] = [
    ...normalizeTasks(sources.tasks ?? []),
    ...normalizeStages(sources.stages ?? []),
    ...normalizeQuotations(sources.quotations ?? []),
    ...normalizeInvoices(sources.invoices ?? []),
    ...normalizeWaMessages(sources.waMessages ?? []),
    ...normalizeLeads(sources.leads ?? []),
    ...normalizeDeals(sources.deals ?? []),
  ];
  const seen = new Set<string>();
  const unique = events.filter((e) => {
    if (seen.has(e.key)) return false;
    seen.add(e.key);
    return true;
  });
  const time = (e: TimelineEvent) => {
    const t = Date.parse(e.at);
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  };
  unique.sort((a, b) => time(b) - time(a));
  return unique.slice(0, limit);
}

/** Kelompokkan per tanggal (YYYY-MM-DD, zona waktu Asia/Jakarta) untuk header UI. */
export function groupByDay(events: TimelineEvent[], timeZone = "Asia/Jakarta"): Array<{ day: string; events: TimelineEvent[] }> {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const groups = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const t = Date.parse(e.at);
    const day = Number.isNaN(t) ? "tanpa-tanggal" : fmt.format(new Date(t));
    const list = groups.get(day) ?? [];
    list.push(e);
    groups.set(day, list);
  }
  return Array.from(groups.entries()).map(([day, list]) => ({ day, events: list }));
}
