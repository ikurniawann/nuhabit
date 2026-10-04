import { redirect } from "next/navigation";
import { RM_ROUTES } from "@/lib/purchasing/item-routes";

export default function Page() {
  redirect(`${RM_ROUTES.inventoryOpname}/insert`);
}
