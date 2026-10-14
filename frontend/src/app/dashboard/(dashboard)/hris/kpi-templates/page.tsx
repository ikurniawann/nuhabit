import { redirect } from "next/navigation";

// The "KPI Templates" menu points here; KPI templates are managed per department on the config page.
export default function Page() {
  redirect("/dashboard/hris/kpi-config");
}
