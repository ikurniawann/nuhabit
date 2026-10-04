import { redirect } from "next/navigation";
import { cashierTabletRoute } from "@/features/pos/tablet-mode";

/** POS Classic sudah dihapus. Bookmark lama diarahkan ke kasir utama. */
export default function PosClassicRedirect() {
  redirect(cashierTabletRoute());
}
