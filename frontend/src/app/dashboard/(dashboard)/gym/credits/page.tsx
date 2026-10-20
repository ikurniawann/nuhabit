import { Suspense } from "react";
import { CreditsPage } from "@/features/gym/credits/components/credits-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CreditsPage />
    </Suspense>
  );
}
