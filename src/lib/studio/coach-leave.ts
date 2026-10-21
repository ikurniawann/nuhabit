/**
 * Cuti & pengganti coach (EPIC-067). Logika murni — tanpa DB — supaya aturan
 * siapa yang boleh memutus bisa dites. Query ada di coach-leave-server.ts.
 */

import { LEAVE_TYPE_LABELS, type LeaveType } from "@/types/hris";

export const PROGRAM_DIRECTOR_ROLE = "program_director";

/**
 * Minimal pemberitahuan cuti coach (T-067-A1). `min_days` = H-N: tanggal mulai
 * paling cepat N hari setelah tanggal pengajuan (WIB). Di bawah itu pengajuan
 * ditolak, kecuali `allow_short_notice` → diterima dan ditandai *mendadak*.
 * `min_days` 0 = tanpa aturan.
 */
export interface LeaveNoticeRule {
  min_days: number;
  allow_short_notice: boolean;
}

export const NOTICE_LEAVE_TYPES = [
  "annual",
  "unpaid",
  "marriage",
  "maternity",
  "pilgrimage",
  "sick",
  "emergency",
  "menstrual",
  "paternity",
  "bereavement",
] as const satisfies readonly LeaveType[];

export type NoticeRules = Record<LeaveType, LeaveNoticeRule>;

/** Default keputusan client 2026-10-21; semuanya bisa diubah di pengaturan. */
export const DEFAULT_NOTICE_RULES: NoticeRules = {
  annual: { min_days: 7, allow_short_notice: false },
  unpaid: { min_days: 7, allow_short_notice: false },
  marriage: { min_days: 14, allow_short_notice: false },
  maternity: { min_days: 30, allow_short_notice: false },
  pilgrimage: { min_days: 30, allow_short_notice: false },
  // Tidak bisa direncanakan: diterima kapan pun, tetapi pengajuan di hari H
  // (atau sesudahnya) tercatat mendadak.
  sick: { min_days: 1, allow_short_notice: true },
  emergency: { min_days: 1, allow_short_notice: true },
  menstrual: { min_days: 1, allow_short_notice: true },
  paternity: { min_days: 1, allow_short_notice: true },
  bereavement: { min_days: 1, allow_short_notice: true },
};

export const MAX_NOTICE_DAYS = 90;

export interface CoachLeaveSettings {
  /** User yang memutus bila tidak ada Program Director yang aktif. */
  backup_approver_user_id: string | null;
  notice_rules: NoticeRules;
}

export const DEFAULT_COACH_LEAVE_SETTINGS: CoachLeaveSettings = {
  backup_approver_user_id: null,
  notice_rules: DEFAULT_NOTICE_RULES,
};

/** Kunci di studio.settings (prefix leave_ supaya tidak bentrok Aturan Booking & job_). */
export const COACH_LEAVE_SETTING_KEYS: Record<keyof CoachLeaveSettings, string> = {
  backup_approver_user_id: "leave_backup_approver_user_id",
  notice_rules: "leave_notice_rules",
};

/** Gabungkan aturan tersimpan (bisa sebagian / dari versi lama) dengan default per jenis cuti. */
export function normalizeNoticeRules(raw: unknown): NoticeRules {
  const stored = raw && typeof raw === "object" ? (raw as Record<string, Partial<LeaveNoticeRule>>) : {};
  const out = {} as NoticeRules;
  for (const type of NOTICE_LEAVE_TYPES) {
    const base = DEFAULT_NOTICE_RULES[type];
    const s = stored[type] ?? {};
    const days = Number.isInteger(s.min_days) ? Math.min(MAX_NOTICE_DAYS, Math.max(0, s.min_days as number)) : base.min_days;
    out[type] = {
      min_days: days,
      allow_short_notice: typeof s.allow_short_notice === "boolean" ? s.allow_short_notice : base.allow_short_notice,
    };
  }
  return out;
}

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

export function addIsoDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export type NoticeEvaluation =
  | { ok: true; shortNotice: boolean; noticeDays: number }
  | { ok: false; noticeDays: number; earliestStart: string };

/** H-N pengajuan: selisih hari kalender tanggal mulai dengan hari ini (WIB); negatif = mundur. */
export function evaluateLeaveNotice(rule: LeaveNoticeRule, startDate: string, today: string): NoticeEvaluation {
  const noticeDays = dayNumber(startDate) - dayNumber(today);
  if (noticeDays >= rule.min_days) return { ok: true, shortNotice: false, noticeDays };
  if (rule.allow_short_notice) return { ok: true, shortNotice: true, noticeDays };
  return { ok: false, noticeDays, earliestStart: addIsoDays(today, rule.min_days) };
}

const tanggalId = (iso: string) =>
  new Date(`${iso}T00:00:00+07:00`).toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });

const hMinus = (days: number) => (days >= 0 ? `H-${days}` : `${-days} hari setelah tanggal mulai`);

/** Pesan penolakan untuk coach (ESS / Coach Portal). */
export function noticeRejectionMessage(type: LeaveType, rule: LeaveNoticeRule, earliestStart: string): string {
  return `${LEAVE_TYPE_LABELS[type]} untuk coach minimal diajukan H-${rule.min_days} sesuai SOP. Tanggal mulai paling cepat ${tanggalId(earliestStart)}.`;
}

/** Keterangan saat pengajuan diterima sebagai cuti mendadak. */
export function shortNoticeMessage(rule: LeaveNoticeRule, noticeDays: number): string {
  return `Tercatat sebagai cuti mendadak (diajukan ${hMinus(noticeDays)}, SOP minimal H-${rule.min_days}).`;
}

export interface ApproverCandidate {
  userId: string;
  name: string;
  /** Sedang cuti/izin hari ini (cuti HRIS disetujui atau time-off coach). */
  onLeave: boolean;
}

export type ApproverSource = "program_director" | "backup" | "super_admin";

export interface ResolvedApprovers {
  approvers: ApproverCandidate[];
  source: ApproverSource;
}

/**
 * Siapa yang memutus cuti coach saat ini:
 *  1. Program Director yang tidak sedang cuti;
 *  2. bila tidak ada → approver cadangan (bila tidak sedang cuti);
 *  3. bila tidak ada juga → hanya Super Admin (selalu boleh menggantikan).
 * Pengaju tidak pernah memutus pengajuannya sendiri — Program Director yang
 * juga mengajar dan mengajukan cuti diputus oleh Program Director lain / cadangan.
 */
export function resolveLeaveApprovers(input: {
  programDirectors: ApproverCandidate[];
  backup: ApproverCandidate | null;
  requesterUserId?: string | null;
}): ResolvedApprovers {
  const eligible = (c: ApproverCandidate) => !c.onLeave && c.userId !== input.requesterUserId;
  const directors = input.programDirectors.filter(eligible);
  if (directors.length > 0) return { approvers: directors, source: "program_director" };
  if (input.backup && eligible(input.backup)) return { approvers: [input.backup], source: "backup" };
  return { approvers: [], source: "super_admin" };
}

/** Super Admin selalu boleh menggantikan (pola approval CRM), kecuali memutus pengajuannya sendiri. */
export function canDecideCoachLeave(
  user: { id: string; role: string },
  resolved: ResolvedApprovers,
  requesterUserId?: string | null
): boolean {
  if (requesterUserId && user.id === requesterUserId) return false;
  if (user.role === "super_admin") return true;
  return resolved.approvers.some((a) => a.userId === user.id);
}
