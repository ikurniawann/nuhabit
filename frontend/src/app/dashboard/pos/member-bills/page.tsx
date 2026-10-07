import { Suspense } from "react";
import { MemberBillsPage } from "@/features/pos/member-bills/components/member-bills-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MemberBillsPage />
    </Suspense>
  );
}
