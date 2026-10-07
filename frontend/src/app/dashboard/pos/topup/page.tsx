import { Suspense } from "react";
import { TopupPage } from "@/features/pos/topup";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Memuat topup...</div>}>
      <TopupPage />
    </Suspense>
  );
}
