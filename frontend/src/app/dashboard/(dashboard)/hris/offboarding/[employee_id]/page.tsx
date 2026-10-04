import { OffboardingPage } from "@/features/hris/offboarding";

export default function Page({ params }: { params: Promise<{ employee_id: string }> }) {
  return <OffboardingPage params={params} />;
}
