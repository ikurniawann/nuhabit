import { redirect } from "next/navigation";
import { cashierTabletRoute } from "@/features/pos/tablet-mode";

/** Shortcut URL for tablet/kiosk cashiers. */
export default function PosTabletModeRedirect() {
  redirect(cashierTabletRoute());
}
