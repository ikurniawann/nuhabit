import { query, queryOne } from "@/lib/db";

/**
 * Relasi tim berbasis hris.employees.reporting_to (permintaan owner
 * 2026-08-29): supervisor/kepala divisi mengelola jadwal shift anggota
 * TIM-NYA SENDIRI dari Area Karyawan: bukan hanya HRD. Sumber
 * kebenarannya kolom reporting_to (dipakai juga struktur organisasi),
 * bukan role IAM, sehingga siapa pun yang tercatat sebagai atasan
 * otomatis mendapat kemampuannya.
 */

export interface TeamMember {
  id: string;
  full_name: string;
  nip: string | null;
  position_title: string | null;
  department_name: string | null;
  photo_url: string | null;
}

/** Bawahan LANGSUNG (reporting_to = atasan) yang masih aktif. */
export async function listDirectSubordinates(
  managerEmployeeId: string
): Promise<TeamMember[]> {
  return query<TeamMember>(
    `SELECT e.id, e.full_name, e.nip, e.photo_url,
            p.title AS position_title, d.name AS department_name
     FROM hris.employees e
     LEFT JOIN hris.positions p ON p.id = e.job_title_id
     LEFT JOIN hris.departments d ON d.id = e.department_id
     WHERE e.reporting_to = $1 AND e.is_active = true
     ORDER BY e.full_name`,
    [managerEmployeeId]
  );
}

/** Benarkah employeeId bawahan langsung managerEmployeeId (dan aktif)? */
export async function isDirectSubordinate(
  managerEmployeeId: string,
  employeeId: string
): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM hris.employees
     WHERE id = $1 AND reporting_to = $2 AND is_active = true`,
    [employeeId, managerEmployeeId]
  );
  return Boolean(row);
}

/**
 * Anggota tim + ringkasan pola shift aktif hari ini per anggota (jumlah hari
 * kerja/minggu + nama shift unik). Karyawan tanpa bawahan → daftar kosong.
 */
export async function listTeamWithSchedule(managerEmployeeId: string) {
  const members = await listDirectSubordinates(managerEmployeeId);
  if (members.length === 0) return [];

  const summary = await query<{
    employee_id: string;
    shift_names: string | null;
    work_days: number;
    effective_from: string | null;
  }>(
    `SELECT es.employee_id,
            string_agg(DISTINCT s.name, ', ' ORDER BY s.name) AS shift_names,
            count(*) FILTER (WHERE es.shift_id IS NOT NULL)::int AS work_days,
            max(es.effective_from)::text AS effective_from
     FROM hris.employee_shifts es
     LEFT JOIN hris.shifts s ON s.id = es.shift_id
     WHERE es.employee_id = ANY($1::uuid[])
       AND es.effective_from <= CURRENT_DATE
       AND (es.effective_to IS NULL OR es.effective_to >= CURRENT_DATE)
     GROUP BY es.employee_id`,
    [members.map((m) => m.id)]
  );
  const byEmployee = new Map(summary.map((row) => [row.employee_id, row]));

  return members.map((m) => {
    const s = byEmployee.get(m.id);
    return {
      ...m,
      schedule_summary: s
        ? `${s.work_days} hari kerja/minggu${s.shift_names ? ` — ${s.shift_names}` : ""}`
        : null,
      schedule_since: s?.effective_from ?? null,
    };
  });
}
