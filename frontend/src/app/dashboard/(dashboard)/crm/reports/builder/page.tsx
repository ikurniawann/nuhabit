import { Suspense } from "react";
import { ReportBuilderPage } from "@/features/crm/report-builder";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ReportBuilderPage />
    </Suspense>
  );
}
