/** Bagi hasil coach (komisi revenue share): tipe respons Go, klien API, label dan form skema. */
import { call, remove, send } from "../shared";

export type CommissionRole = "head_coach" | "coach" | "assistant";
export type PayoutChannel = "payroll" | "direct";
export type CommissionStatus = "preview" | "draft" | "approved" | "paid";
export type PaymentMethod = "payroll" | "cash" | "transfer";

export interface CommissionSettings {
  classPoolPercent: number;
  ptPoolPercent: number;
  shareHeadCoachPercent: number;
  shareCoachPercent: number;
  shareAssistantPercent: number;
  deductionPercents: Record<string, number>;
  maxDeductionPercent: number;
  payoutChannel: PayoutChannel;
}

export interface CommissionIncident {
  id: string;
  kind: string;
  occurredOn: string;
  percent: number;
}

export interface CommissionLine {
  /** "" pada pratinjau: baris baru tersimpan saat draf atau persetujuan. */
  id: string;
  coachId: string;
  coachName: string;
  role: CommissionRole;
  sharePercent: number;
  classSessions: number;
  ptSessions: number;
  attendees: number;
  allSessions: number;
  attributionPercent: number;
  grossIdr: number;
  deductionPercent: number;
  deductionIdr: number;
  amountIdr: number;
  incidents: CommissionIncident[];
  status: "pending" | "paid";
  paymentMethod: PaymentMethod | null;
  paymentReference: string | null;
  payrollPeriod: string | null;
  paidAt: string | null;
}

/** Satu cabang satu bulan. */
export interface CommissionMonth {
  branchId: string;
  branchName: string;
  periodMonth: string;
  status: CommissionStatus;
  statementId: string | null;
  schemeId: string | null;
  schemeName: string | null;
  /** null: cabang ini belum punya skema bagi hasil aktif. */
  settings: CommissionSettings | null;
  monthOver: boolean;
  computedAt: string | null;
  approvedAt: string | null;
  classRevenueIdr: number;
  ptRevenueIdr: number;
  classPoolIdr: number;
  ptPoolIdr: number;
  totalPoolIdr: number;
  allocatedPercent: number;
  allocatedIdr: number;
  retainedIdr: number;
  overAllocated: boolean;
  lines: CommissionLine[];
}

export interface CommissionSchemeRow extends CommissionSettings {
  id: string;
  branchId: string | null;
  branchName: string | null;
  name: string;
  isActive: boolean;
  updatedAt: string;
}

export interface CommissionCoach {
  id: string;
  name: string;
  status: string;
  role: CommissionRole;
  sharePercent: number | null;
}

export interface CommissionSettingsView {
  schemes: CommissionSchemeRow[];
  branches: { id: string; name: string }[];
  coaches: CommissionCoach[];
  defaults: CommissionSettings;
}

export interface MyCommissionLine extends CommissionLine {
  branchId: string;
  branchName: string;
  periodMonth: string;
  statementStatus: CommissionStatus;
  schemeName: string;
  totalPoolIdr: number;
}

export interface MyCommission {
  coach: { id: string; name: string } | null;
  month: MyCommissionLine[];
  history: (CommissionLine & { periodMonth: string; branchId: string; branchName: string; statementStatus: CommissionStatus })[];
}

export interface SchemeInput {
  id?: string;
  branch_id: string | null;
  name: string;
  class_pool_percent: number;
  pt_pool_percent: number;
  share_head_coach_percent: number;
  share_coach_percent: number;
  share_assistant_percent: number;
  deduction_percents: Record<string, number>;
  max_deduction_percent: number;
  payout_channel: PayoutChannel;
  is_active: boolean;
}

const BASE = "/api/gym/incentives/commission";

export const commissionApi = {
  months: (month: string) => call<CommissionMonth[]>(`${BASE}?month=${month}`),
  act: (branchId: string, month: string, action: "draft" | "approve") =>
    send<CommissionMonth>(BASE, { branch_id: branchId, month, action }),
  payLine: (id: string, method: PaymentMethod, reference?: string) =>
    send<{ id: string }>(`${BASE}/lines/${id}`, { method, payment_reference: reference || null }),
  settings: () => call<CommissionSettingsView>(`${BASE}/settings`),
  saveScheme: (input: SchemeInput) => send<{ id: string }>(`${BASE}/settings`, input),
  deleteScheme: (id: string) => remove<{ id: string }>(`${BASE}/settings?id=${id}`),
  saveCoach: (id: string, role: CommissionRole, sharePercent: number | null) =>
    send<{ id: string }>(`${BASE}/coaches/${id}`, { role, share_percent: sharePercent }, "PUT"),
  mine: (month: string) => call<MyCommission>(`/api/gym/my-classes/commission?month=${month}`),
};

export const ROLE_LABELS: Record<CommissionRole, string> = {
  head_coach: "Head coach",
  coach: "Coach",
  assistant: "Asisten coach",
};

export const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = {
  preview: "Pratinjau",
  draft: "Draf",
  approved: "Disetujui",
  paid: "Dibayar",
};

export const COMMISSION_STATUS_VARIANT: Record<CommissionStatus, "outline" | "muted" | "info" | "success"> = {
  preview: "muted",
  draft: "outline",
  approved: "info",
  paid: "success",
};

export const CHANNEL_LABELS: Record<PayoutChannel, string> = {
  payroll: "Lewat payroll",
  direct: "Di luar payroll",
};

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  payroll: "Payroll",
  cash: "Tunai",
  transfer: "Transfer",
};

/** Jenis pelanggaran yang dicatat modul disiplin coach. */
export const INCIDENT_LABELS: Record<string, string> = {
  no_show: "Tidak hadir tanpa kabar",
  short_notice_leave: "Cuti mendadak",
  late: "Terlambat",
};

export const incidentLabel = (kind: string) => INCIDENT_LABELS[kind] ?? kind.replaceAll("_", " ");

/** "12,5%" untuk persen dari server (dua desimal). */
export const formatPercent = (value: number) =>
  `${value.toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;

/* ── Form skema ──────────────────────────────────────────────────────── */

/** Field form skema sebagai teks input; deductions per jenis pelanggaran. */
export interface SchemeForm {
  branch_id: string;
  name: string;
  class_pool_percent: string;
  pt_pool_percent: string;
  share_head_coach_percent: string;
  share_coach_percent: string;
  share_assistant_percent: string;
  max_deduction_percent: string;
  payout_channel: PayoutChannel;
  is_active: boolean;
  deductions: Record<string, string>;
}

export function initialSchemeForm(scheme: CommissionSchemeRow | null, defaults: CommissionSettings): SchemeForm {
  const s = scheme ?? defaults;
  const kinds = { ...defaults.deductionPercents, ...s.deductionPercents };
  return {
    branch_id: scheme?.branchId ?? "",
    name: scheme?.name ?? "",
    class_pool_percent: String(s.classPoolPercent),
    pt_pool_percent: String(s.ptPoolPercent),
    share_head_coach_percent: String(s.shareHeadCoachPercent),
    share_coach_percent: String(s.shareCoachPercent),
    share_assistant_percent: String(s.shareAssistantPercent),
    max_deduction_percent: String(s.maxDeductionPercent),
    payout_channel: s.payoutChannel,
    is_active: scheme?.isActive ?? true,
    deductions: Object.fromEntries(
      Object.keys(kinds).map((k) => [k, String(scheme ? (s.deductionPercents[k] ?? 0) : kinds[k])])
    ),
  };
}

/** Persen 0 sampai 100 dari teks input ("12,5" boleh); null bila tidak valid. */
export function parsePercent(text: string): number | null {
  const v = Number(text.trim().replace(",", "."));
  return text.trim() !== "" && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
}

const PERCENT_FIELDS = [
  "class_pool_percent",
  "pt_pool_percent",
  "share_head_coach_percent",
  "share_coach_percent",
  "share_assistant_percent",
  "max_deduction_percent",
] as const;

/** Payload simpan skema, atau pesan kesalahan pertama. */
export function toSchemeInput(form: SchemeForm, id: string | undefined, isDefault: boolean): SchemeInput | string {
  if (form.name.trim().length < 2) return "Nama skema minimal 2 huruf.";
  if (!isDefault && !form.branch_id) return "Pilih cabang untuk skema ini.";
  const percents = {} as Record<(typeof PERCENT_FIELDS)[number], number>;
  for (const key of PERCENT_FIELDS) {
    const v = parsePercent(form[key]);
    if (v === null) return "Persentase harus 0 sampai 100.";
    percents[key] = v;
  }
  const deductions: Record<string, number> = {};
  for (const [kind, text] of Object.entries(form.deductions)) {
    const v = parsePercent(text);
    if (v === null) return `Potongan ${incidentLabel(kind)} harus 0 sampai 100.`;
    deductions[kind] = v;
  }
  return {
    ...(id ? { id } : {}),
    branch_id: isDefault ? null : form.branch_id,
    name: form.name.trim(),
    ...percents,
    deduction_percents: deductions,
    payout_channel: form.payout_channel,
    is_active: form.is_active,
  };
}
