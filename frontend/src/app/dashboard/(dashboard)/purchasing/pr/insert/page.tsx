import { Suspense } from "react";
import { NewPRPage } from "@/features/purchasing/pr";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <NewPRPage />
    </Suspense>
  );
}
