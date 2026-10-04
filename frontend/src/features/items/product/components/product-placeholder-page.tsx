import { ComingSoonPage } from "@/components/dashboard/coming-soon-page";
import { ITEMS_LANDING_PATH } from "@/lib/purchasing/item-routes";

type ProductPlaceholderPageProps = {
  title: string;
  description: string;
};

export function ProductPlaceholderPage({ title, description }: ProductPlaceholderPageProps) {
  return (
    <ComingSoonPage
      title={title}
      description={description}
      backHref={ITEMS_LANDING_PATH}
      backLabel="Kembali ke Items"
    />
  );
}
