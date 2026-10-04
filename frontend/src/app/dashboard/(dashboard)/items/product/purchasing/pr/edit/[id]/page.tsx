import { EditProductPRPage } from "@/features/purchasing/product-pr";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default function Page({ params }: PageProps) {
  return <EditProductPRPage params={params} />;
}
