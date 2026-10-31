import { QuotationDocumentPage } from "@/features/sales-funnel/quotations";

export default async function QuotationRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuotationDocumentPage quotationId={id} />;
}
