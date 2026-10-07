import { ProductStockOpnameCreatePage } from "@/features/inventory/product-stock-opname";

type PageProps = {
  searchParams: Promise<{ id?: string }>;
};

export default async function Page({ searchParams }: PageProps) {
  const { id } = await searchParams;
  return <ProductStockOpnameCreatePage opnameId={id} />;
}
