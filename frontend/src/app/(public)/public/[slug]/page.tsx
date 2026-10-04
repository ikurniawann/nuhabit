import { notFound } from "next/navigation";
import { PublicFormPage } from "@/features/crm/public-form";
import { loadPublicForm, publicFormView } from "@/lib/crm/public-forms-server";

export const dynamic = "force-dynamic";

/** Form publik tambahan: poskopi.reddie.id/public/<slug>. */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const form = await loadPublicForm(slug);
  if (!form) notFound();
  return <PublicFormPage form={publicFormView(form)} />;
}
