import { JournalMappingFormPage } from "@/features/accounting/journal-mappings/components/journal-mapping-form-page";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <JournalMappingFormPage mode="edit" mappingId={id} />;
}
