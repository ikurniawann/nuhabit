import { PurchasingLayout } from "@/features/purchasing/layout";

export default function PurchasingDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PurchasingLayout>{children}</PurchasingLayout>;
}
