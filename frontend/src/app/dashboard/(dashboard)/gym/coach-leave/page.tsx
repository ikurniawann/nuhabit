import { Suspense } from "react";
import { CoachLeavePage } from "@/features/gym/coach-leave/components/coach-leave-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CoachLeavePage />
    </Suspense>
  );
}
