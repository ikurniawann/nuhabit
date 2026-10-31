import { QuotationDocumentPage } from "@/features/sales-funnel/quotations";

export default async function NewQuotationRoute({
  searchParams,
}: {
  searchParams: Promise<{ deal?: string | string[] }>;
}) {
  const { deal } = await searchParams;
  return <QuotationDocumentPage dealId={typeof deal === "string" ? deal : ""} />;
}
