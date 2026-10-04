import { redirect } from "next/navigation";

// Penerimaan PO dilakukan lewat GRN.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/purchasing/grn/insert?po_id=${id}`);
}
