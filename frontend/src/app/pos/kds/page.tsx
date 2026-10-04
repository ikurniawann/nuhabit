import { requireUser } from "@/lib/auth/require-user";
import { KdsPage } from "@/features/pos/kds";

// Fullscreen KDS murni: di LUAR /dashboard/pos layout (App Router tidak bisa
// opt-out layout induk) supaya tanpa sidebar/navbar. Pola sama layar customer.
export default async function Page() {
  await requireUser();
  return (
    <>
      <KdsPage />
    </>
  );
}
