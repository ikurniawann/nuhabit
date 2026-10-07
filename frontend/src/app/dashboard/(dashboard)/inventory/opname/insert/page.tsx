import { StockOpnameCreatePage } from "@/features/inventory/stock-opname";

type PageProps = {
  searchParams: Promise<{ id?: string }>;
};

export default async function Page({ searchParams }: PageProps) {
  const { id } = await searchParams;
  return <StockOpnameCreatePage opnameId={id} />;
}
