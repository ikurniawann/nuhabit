import { Suspense } from "react";
import { ApprovalsInboxPage } from "@/features/crm/advance";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ApprovalsInboxPage />
    </Suspense>
  );
}
