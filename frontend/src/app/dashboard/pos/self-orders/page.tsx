import { Suspense } from "react";
import { SelfOrdersPage } from "@/features/pos/self-orders/components/self-orders-page";

export default function PosSelfOrdersRoutePage() {
  return (
    <Suspense fallback={null}>
      <SelfOrdersPage />
    </Suspense>
  );
}
