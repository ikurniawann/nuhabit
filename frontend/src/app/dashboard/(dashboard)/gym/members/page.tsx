import { Suspense } from "react";
import { MembersPage } from "@/features/gym/members/components/members-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MembersPage />
    </Suspense>
  );
}
