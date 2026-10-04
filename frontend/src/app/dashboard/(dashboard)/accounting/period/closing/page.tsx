import { Suspense } from "react";
import { PeriodClosingPage } from "@/features/accounting/period";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PeriodClosingPage />
    </Suspense>
  );
}
