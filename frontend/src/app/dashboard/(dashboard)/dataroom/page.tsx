import { Suspense } from "react";
import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { DataroomPage } from "@/features/dataroom";

export const metadata = { title: "Dataroom" };

export default async function Page() {
  await requireIamPage(IAM.dataroom);
  return (
    <Suspense fallback={null}>
      <DataroomPage />
    </Suspense>
  );
}
