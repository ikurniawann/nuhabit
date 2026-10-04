import { redirect } from "next/navigation";
import { ITEMS_LANDING_PATH } from "@/lib/purchasing/item-routes";

export default function PurchasingMainRedirectPage() {
  redirect(ITEMS_LANDING_PATH);
}
