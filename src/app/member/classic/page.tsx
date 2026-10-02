import { MemberPortalPage } from "@/features/member-portal/components/member-portal-page";

/**
 * /member/classic — portal member lama warisan BCD (kartu-kartu ringkas).
 * /member kini Member App NüHabit (EPIC-057); rute ini tidak lagi dipromosikan.
 */
export default function Page() {
  return (
    <div className="member-portal member-portal-bg min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col px-3 pb-8 pt-5 sm:px-4">
        <MemberPortalPage />
      </div>
    </div>
  );
}
