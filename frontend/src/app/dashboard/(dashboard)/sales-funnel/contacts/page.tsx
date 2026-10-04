import { Suspense } from "react";
import { SalesContactsPage } from "@/features/sales-funnel/contacts";

export default function SalesFunnelContactsRoute() {
  return (
    <Suspense fallback={null}>
      <SalesContactsPage />
    </Suspense>
  );
}
