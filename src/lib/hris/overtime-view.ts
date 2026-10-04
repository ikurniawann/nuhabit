/**
 * Logika murni halaman HRIS Lembur (EPIC-008 Fase B): filter daftar,
 * validasi penugasan lembur, dan hitungan pengajuan menunggu.
 */

/** Bulan berjalan untuk input type="month": "2026-10". */
export function currentMonthValue(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Query string daftar lembur; status "all" dan bulan kosong tidak dikirim. */
export function overtimeListParams(status: string, month: string) {
  const [year, monthNumber] = month ? month.split("-") : [];
  return {
    status: status === "all" ? undefined : status,
    year,
    month: monthNumber,
  };
}

export interface OvertimeAssignForm {
  employee_id: string;
  date: string;
  start_time: string;
  end_time: string;
  reason: string;
}

export const EMPTY_OVERTIME_ASSIGN_FORM: OvertimeAssignForm = {
  employee_id: "",
  date: "",
  start_time: "",
  end_time: "",
  reason: "",
};

export function validateOvertimeAssignForm(form: OvertimeAssignForm): string | null {
  if (!form.employee_id) return "Pilih karyawan yang ditugaskan";
  if (!form.date || !form.start_time || !form.end_time) return "Tanggal dan jam lembur wajib diisi";
  if (form.reason.trim().length < 5) return "Alasan/pekerjaan minimal 5 karakter";
  return null;
}

/** Pengajuan dari karyawan yang masih menunggu keputusan HRD. */
export function countPendingEmployeeRequests(rows: readonly { source: string; status: string }[]): number {
  return rows.filter((row) => row.source === "employee" && row.status === "pending").length;
}
