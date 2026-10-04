import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { BookingsPage } from "@/features/ticketing/bookings";

// Keputusan owner 2026-07-22: loket (pos/pos_supervisor) boleh membantu
// pengunjung — lihat daftar/rincian & kirim ulang WA. Aksi ber-uang
// (batalkan, catatan refund, tutup alert webhook) tetap super_admin;
// server menolak terlepas dari UI.
const OPERATOR_ROLES = ["super_admin", "pos_supervisor", "pos"];

export default async function TicketingBookingRoute() {
  const user = await requireUser();
  if (!OPERATOR_ROLES.includes(user.role)) {
    redirect("/dashboard");
  }
  return <BookingsPage canManage={user.role === "super_admin"} />;
}
