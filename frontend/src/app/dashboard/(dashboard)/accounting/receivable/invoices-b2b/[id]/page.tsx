import { FinanceInvoiceDocumentPage } from "@/features/finance/invoices";

export default async function ReceivableInvoiceRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinanceInvoiceDocumentPage invoiceId={id} />;
}
