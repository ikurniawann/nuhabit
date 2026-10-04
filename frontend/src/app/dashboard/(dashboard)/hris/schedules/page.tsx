import { redirect } from "next/navigation";

/**
 * Halaman Schedules lama (pola `staff_schedules` berbasis tabel `staff`) sudah
 * digantikan Shift Kerja (`hris.shifts` + `hris.employee_shifts`) yang jadi
 * sumber kebenaran jadwal untuk absensi, cuti, lembur, dan payroll (EPIC-015).
 * Redirect permanen untuk bookmark lama.
 */
export default function Page() {
  redirect("/dashboard/hris/shifts");
}
