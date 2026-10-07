import { redirect } from "next/navigation";

/**
 * Halaman Sections lama (pola `staff_sections` berbasis tabel `staff`) sudah
 * tidak dipakai; pengelompokan karyawan kini hidup di data karyawan
 * (department/posisi) — EPIC-015. Redirect permanen untuk bookmark lama.
 */
export default function Page() {
  redirect("/dashboard/employees");
}
