import { MemberPortalPage } from "@/features/member-portal/components/member-portal-page";
import { LegacyMemberShell } from "../legacy-shell";

/**
 * /member/classic — portal member lama (kartu-kartu ringkas).
 *
 * Dipertahankan sebagai fallback (keputusan owner 2026-08-15): kalau portal
 * utama bermasalah di perangkat tertentu, member tetap punya jalan masuk yang
 * terbukti bekerja.
 */
export default function Page() {
  return (
    <LegacyMemberShell>
      <MemberPortalPage />
    </LegacyMemberShell>
  );
}
