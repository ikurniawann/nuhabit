import { Suspense } from "react";
import { MyClassesPage } from "@/features/gym/my-classes/components/my-classes-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MyClassesPage />
    </Suspense>
  );
}
