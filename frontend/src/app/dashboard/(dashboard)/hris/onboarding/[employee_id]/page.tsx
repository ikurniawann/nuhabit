import { OnboardingPage } from "@/features/hris/onboarding";

export default function Page({ params }: { params: Promise<{ employee_id: string }> }) {
  return <OnboardingPage params={params} />;
}
