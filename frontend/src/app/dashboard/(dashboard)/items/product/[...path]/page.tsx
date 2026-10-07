import { notFound } from "next/navigation";
import { ProductPlaceholderPage } from "@/features/items/product/components/product-placeholder-page";
import { getProductPlaceholder } from "@/features/items/product/placeholder-config";

type PageProps = {
  params: Promise<{ path: string[] }>;
};

export default async function Page({ params }: PageProps) {
  const { path } = await params;
  const slug = path.join("/");
  const config = getProductPlaceholder(slug);

  if (!config) {
    notFound();
  }

  return <ProductPlaceholderPage title={config.title} description={config.description} />;
}
