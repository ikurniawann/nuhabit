import { FiscalYearFormPage } from "@/features/accounting/fiscal-years/components/fiscal-year-form-page";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <FiscalYearFormPage mode="edit" fiscalYearId={id} />;
}
