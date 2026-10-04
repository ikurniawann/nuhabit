import { VendorDetailPage } from "@/features/purchasing/vendors";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <VendorDetailPage id={id} />;
}
