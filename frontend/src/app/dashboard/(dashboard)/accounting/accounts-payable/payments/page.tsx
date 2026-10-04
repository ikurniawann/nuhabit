import { Suspense } from "react";
import { ApPaymentsPage } from "@/features/accounting/ap";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ApPaymentsPage />
    </Suspense>
  );
}
