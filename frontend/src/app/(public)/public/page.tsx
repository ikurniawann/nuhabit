import { notFound } from "next/navigation";
import { PublicFormPage } from "@/features/crm/public-form";
import { loadPublicForm, publicFormView } from "@/lib/crm/public-forms-server";

export const dynamic = "force-dynamic";

/** EPIC-050 T-5.3 — halaman publik utama: form "kontak". */
export default async function Page() {
  const form = await loadPublicForm("kontak");
  if (!form) notFound();
  return <PublicFormPage form={publicFormView(form)} />;
}
