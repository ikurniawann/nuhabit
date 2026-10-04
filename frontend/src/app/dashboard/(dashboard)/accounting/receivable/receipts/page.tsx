import { Suspense } from "react";
import { ArReceiptsPage } from "@/features/accounting/ar";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ArReceiptsPage />
    </Suspense>
  );
}
