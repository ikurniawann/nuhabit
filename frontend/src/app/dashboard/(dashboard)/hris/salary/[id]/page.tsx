import { EditSalaryPage } from "@/features/hris/salary";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <EditSalaryPage params={params} />;
}
