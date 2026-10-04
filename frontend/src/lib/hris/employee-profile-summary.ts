/** Ringkasan untuk halaman detail karyawan: masa kerja, absensi bulan ini, saldo cuti. */

/** "2 yr 3 mo" / "5 mo" / "Just joined"; dihitung per bulan kalender. */
export function calculateTenure(joinDate: string, now: Date = new Date()): string {
  const join = new Date(joinDate);
  if (Number.isNaN(join.getTime())) return "-";
  const totalMonths =
    (now.getFullYear() - join.getFullYear()) * 12 + (now.getMonth() - join.getMonth());
  if (totalMonths <= 0) return "Just joined";
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  return years > 0 ? `${years} yr ${months} mo` : `${months} mo`;
}

interface AttendanceLike {
  status?: string | null;
  is_late?: boolean;
  work_hours?: number | null;
}

export function summarizeAttendance(rows: AttendanceLike[]) {
  return {
    present: rows.filter((a) => a.status === "present").length,
    late: rows.filter((a) => a.is_late).length,
    absent: rows.filter((a) => a.status === "absent").length,
    totalHours: rows.reduce((sum, a) => sum + (a.work_hours || 0), 0),
  };
}

interface LeaveBalanceLike {
  total_days?: number;
  used_days?: number;
  remaining_days?: number;
  balance?: number;
  quota?: number;
  used?: number;
}

/** API saldo cuti punya dua bentuk kolom (baru *_days, lama balance/quota/used). */
export function leaveBalanceUsage(row: LeaveBalanceLike) {
  const total = row.total_days ?? row.quota;
  const used = row.used_days ?? row.used;
  const percent = Math.min(100, ((used ?? 0) / (total ?? 1)) * 100);
  return { remaining: row.remaining_days ?? row.balance, total, used, percent };
}
