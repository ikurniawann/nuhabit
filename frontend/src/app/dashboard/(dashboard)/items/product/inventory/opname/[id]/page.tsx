import { ProductStockOpnameDetailPage } from "@/features/inventory/product-stock-opname";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <ProductStockOpnameDetailPage id={id} />;
}
