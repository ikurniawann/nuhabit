import { JournalEntryFormPage } from "@/features/accounting/journal-entries/components/journal-entry-form-page";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <JournalEntryFormPage mode="edit" entryId={id} />;
}
