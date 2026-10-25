/** Klien API portal investor. Rasio dikirim 0..1; rupiah tanpa desimal. */
import { call, remove, send, upload } from "@/features/gym/shared";

export const STREAMS = ["packages", "passes", "pt", "pos"] as const;
export type Stream = (typeof STREAMS)[number];

export const STREAM_LABELS: Record<Stream, string> = {
  packages: "Paket kredit",
  passes: "Pass",
  pt: "Personal training",
  pos: "Toko / POS",
};

export interface Compared {
  value: number;
  previous: number;
  /** Perubahan relatif terhadap periode sebelumnya; null bila sebelumnya 0. */
  change: number | null;
}

export interface Branch {
  id: string;
  name: string;
  timezone: string;
}

export interface DayRevenue {
  day: string;
  total: number;
  streams: Record<Stream, number>;
  branches: Record<string, number>;
}

export interface Overview {
  timezone: string;
  today: string;
  generated_at: string;
  revenue: { today: Compared; mtd: Compared; ytd: Compared; mtd_streams: Record<Stream, number> };
  members: { active: number; previous_active: number; new: Compared; churned: number; churn_rate: number };
  classes: { sessions: number; checked_in: number; avg_fill: number; no_show_rate: number };
  pt_sessions: Compared;
  ark_coin_outstanding: number;
  deferred_revenue: { credits: number; passes: number; total: number };
  daily: DayRevenue[];
  branches: Branch[];
}

export interface MonthAccounting {
  revenue: number;
  cogs: number;
  gross_profit: number;
  gross_margin: number | null;
  expenses: number;
  operating_income: number;
  net_income: number;
}

export interface MonthRow {
  month: string;
  revenue: { total: number; streams: Record<Stream, number> };
  accounting: MonthAccounting | null;
  members: { new: number; active: number; retained: number; retention_rate: number | null };
  classes: { sessions: number; checked_in: number; avg_fill: number };
  pt_sessions: number;
}

export interface Performance {
  timezone: string;
  from: string;
  to: string;
  months: MonthRow[];
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size_bytes: number;
  url: string;
  created_at: string;
}

export interface Update {
  id: string;
  title: string;
  body: string;
  status: "draft" | "published";
  published_at: string | null;
  updated_at: string;
  attachments: Attachment[];
}

export interface ManagedUpdate extends Update {
  created_by_name: string | null;
  created_at: string;
}

export interface Document extends Attachment {
  update_id: string;
  update_title: string;
  published_at: string;
}

export interface UpdateInput {
  title: string;
  body: string;
}

const withBranch = (branchId: string, extra?: Record<string, string>) => {
  const q = new URLSearchParams(extra);
  if (branchId) q.set("branch_id", branchId);
  const s = q.toString();
  return s ? `?${s}` : "";
};

export const INVESTOR_KEYS = {
  overview: (branchId: string) => ["investor", "overview", branchId] as const,
  performance: (branchId: string, months: number) => ["investor", "performance", branchId, months] as const,
  branches: ["investor", "branches"] as const,
  updates: ["investor", "updates"] as const,
  manage: ["investor", "updates", "manage"] as const,
  documents: ["investor", "documents"] as const,
  digest: ["investor", "digest"] as const,
};

export const investorApi = {
  overview: (branchId: string) => call<Overview>(`/api/investor/overview${withBranch(branchId)}`),
  performance: (branchId: string, months: number) =>
    call<Performance>(`/api/investor/performance${withBranch(branchId, { months: String(months) })}`),
  branches: () => call<Branch[]>("/api/investor/branches"),
  updates: () => call<Update[]>("/api/investor/updates"),
  documents: () => call<Document[]>("/api/investor/documents"),
  digest: () => call<{ enabled: boolean }>("/api/investor/digest"),
  setDigest: (enabled: boolean) => send<{ enabled: boolean }>("/api/investor/digest", { enabled }, "PUT"),
  manage: () => call<ManagedUpdate[]>("/api/investor/updates/manage"),
  create: (input: UpdateInput) => send<ManagedUpdate>("/api/investor/updates", input),
  edit: (id: string, input: UpdateInput) => send<ManagedUpdate>(`/api/investor/updates/${id}`, input, "PATCH"),
  setPublished: (id: string, published: boolean) =>
    send<ManagedUpdate>(`/api/investor/updates/${id}/published`, { published }, "PUT"),
  delete: (id: string) => remove<{ id: string }>(`/api/investor/updates/${id}`),
  attach: (id: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return upload<ManagedUpdate>(`/api/investor/updates/${id}/attachments`, body);
  },
  detach: (id: string, attachmentId: string) =>
    remove<ManagedUpdate>(`/api/investor/updates/${id}/attachments/${attachmentId}`),
};
