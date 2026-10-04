import { redirect } from "next/navigation";

/**
 * Halaman Logbook List lama sudah dilebur ke tab Riwayat di
 * /dashboard/hris/logbook (EPIC-009). Redirect permanen.
 */
export default function Page() {
  redirect("/dashboard/hris/logbook");
}
