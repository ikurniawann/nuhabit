/**
 * Aturan otorisasi keputusan pengajuan lembur (EPIC-008 Fase B) — murni &
 * teruji, dipakai POST /api/hris/overtime/decide.
 *
 * source 'employee' : HRD atau atasan langsung yang memutuskan;
 *                     pengaju TIDAK boleh memutuskan pengajuannya sendiri
 *                     sekalipun ber-role HR (jam lembur masuk gaji).
 * source 'company'  : hanya karyawan yang ditugaskan yang mengonfirmasi.
 * cancel            : pembuat pengajuan (atau HR utk penugasan company),
 *                     selama masih pending.
 */

export interface OvertimeDecisionActor {
  employeeId: string | null;
  isHr: boolean;
}

export interface OvertimeDecisionRequest {
  employee_id: string;
  requested_by: string | null;
  source: "employee" | "company";
  reporting_to: string | null;
}

export type OvertimeDecisionAction = "approve" | "reject" | "cancel";

export function canDecideOvertime(
  actor: OvertimeDecisionActor,
  request: OvertimeDecisionRequest,
  action: OvertimeDecisionAction
): { allowed: boolean; reason?: string } {
  const isTargetEmployee =
    actor.employeeId !== null && request.employee_id === actor.employeeId;
  const isRequester =
    actor.employeeId !== null && request.requested_by === actor.employeeId;
  const isDirectManager =
    actor.employeeId !== null && request.reporting_to === actor.employeeId;

  if (action === "cancel") {
    const canCancel = isRequester || (request.source === "company" && actor.isHr);
    return canCancel
      ? { allowed: true }
      : { allowed: false, reason: "Hanya pembuat pengajuan yang bisa membatalkan" };
  }

  if (request.source === "company") {
    return isTargetEmployee
      ? { allowed: true }
      : {
          allowed: false,
          reason: "Hanya karyawan yang ditugaskan yang bisa mengonfirmasi penugasan ini",
        };
  }

  // source 'employee'
  if (isTargetEmployee) {
    return {
      allowed: false,
      reason: "Tidak bisa memutuskan pengajuan lembur sendiri",
    };
  }
  if (!actor.isHr && !isDirectManager) {
    return {
      allowed: false,
      reason: "Hanya HRD/atasan langsung yang bisa memproses pengajuan ini",
    };
  }
  return { allowed: true };
}
