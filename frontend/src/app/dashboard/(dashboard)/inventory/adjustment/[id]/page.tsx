import { redirect } from "next/navigation";
import { RM_ROUTES } from "@/lib/purchasing/item-routes";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  redirect(RM_ROUTES.inventoryOpnameDetail(id));
}
