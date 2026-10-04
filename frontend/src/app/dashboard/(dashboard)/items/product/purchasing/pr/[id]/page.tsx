import { ProductPRDetailPage } from "@/features/purchasing/product-pr";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default function Page({ params }: PageProps) {
  return <ProductPRDetailPage params={params} />;
}
