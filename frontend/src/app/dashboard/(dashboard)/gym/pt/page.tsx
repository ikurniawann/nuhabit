import { Suspense } from "react";
import { PtPage } from "@/features/gym/coaching/components/pt-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PtPage />
    </Suspense>
  );
}
