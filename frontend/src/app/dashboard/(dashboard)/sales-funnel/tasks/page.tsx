import { Suspense } from "react";
import { SalesTasksPage } from "@/features/sales-funnel/tasks";

export default function SalesFunnelTasksRoute() {
  return (
    <Suspense fallback={null}>
      <SalesTasksPage />
    </Suspense>
  );
}
