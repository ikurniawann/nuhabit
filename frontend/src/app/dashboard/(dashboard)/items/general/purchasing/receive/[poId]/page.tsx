import { GeneralReceiveFormPage } from "@/features/purchasing/general-receive";

export default async function Page({
  params,
}: {
  params: Promise<{ poId: string }>;
}) {
  const { poId } = await params;
  return <GeneralReceiveFormPage poId={poId} />;
}
