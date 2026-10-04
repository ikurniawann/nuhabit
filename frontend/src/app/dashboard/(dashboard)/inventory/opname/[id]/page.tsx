import { StockOpnameDetailPage } from "@/features/inventory/stock-opname";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <StockOpnameDetailPage id={id} />;
}
