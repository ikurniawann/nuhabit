import { NoxPortal } from "@/features/member-portal/nox/nox-portal";
import { LegacyMemberShell } from "../legacy-shell";

/** /member/nox — portal "Nox Lab" (tampilan desktop), sebelumnya di /member. */
export default function Page() {
  return (
    <LegacyMemberShell>
      <NoxPortal />
    </LegacyMemberShell>
  );
}
