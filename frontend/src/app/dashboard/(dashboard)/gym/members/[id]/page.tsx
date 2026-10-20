import { Suspense } from "react";
import { MemberDetailPage } from "@/features/gym/members/components/member-detail-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <MemberDetailPage customerId={id} />
    </Suspense>
  );
}
