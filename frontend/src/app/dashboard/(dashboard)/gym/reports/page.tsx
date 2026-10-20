import { Suspense } from "react";
import { ReportsPage } from "@/features/gym/reports/components/reports-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ReportsPage />
    </Suspense>
  );
}
