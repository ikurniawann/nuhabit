import { BeginningBalancePage } from "@/features/accounting/beginning-balance/components/beginning-balance-page";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <BeginningBalancePage fiscalYearId={id} />;
}
