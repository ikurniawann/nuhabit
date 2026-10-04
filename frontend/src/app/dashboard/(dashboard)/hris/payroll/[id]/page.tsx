import { PayrollDetailPage } from "@/features/hris/payroll";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PayrollDetailPage params={params} />;
}
