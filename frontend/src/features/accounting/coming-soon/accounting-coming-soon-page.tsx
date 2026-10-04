import { ComingSoonPage } from "@/components/dashboard/coming-soon-page";

export function AccountingComingSoonPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <ComingSoonPage
      title={title}
      description={description}
      backHref="/dashboard/accounting/reports"
      backLabel="Kembali ke Dashboard Accounting"
    />
  );
}

export function createAccountingComingSoonPage(title: string, description: string) {
  return function AccountingComingSoonRoutePage() {
    return <AccountingComingSoonPage title={title} description={description} />;
  };
}
