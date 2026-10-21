/**
 * Cuti & pengganti coach (EPIC-067). Logika murni — tanpa DB — supaya aturan
 * siapa yang boleh memutus bisa dites. Query ada di coach-leave-server.ts.
 */

export const PROGRAM_DIRECTOR_ROLE = "program_director";

export interface CoachLeaveSettings {
  /** User yang memutus bila tidak ada Program Director yang aktif. */
  backup_approver_user_id: string | null;
}

export const DEFAULT_COACH_LEAVE_SETTINGS: CoachLeaveSettings = {
  backup_approver_user_id: null,
};

/** Kunci di studio.settings (prefix leave_ supaya tidak bentrok Aturan Booking & job_). */
export const COACH_LEAVE_SETTING_KEYS: Record<keyof CoachLeaveSettings, string> = {
  backup_approver_user_id: "leave_backup_approver_user_id",
};

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
