import { VendorPriceListDetailPage } from "@/features/purchasing/vendor-price-list";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <VendorPriceListDetailPage id={id} />;
}
