import { redirect } from "next/navigation";
import { KDS_ROUTES } from "@/features/pos/kds/constants";

export default function Page() {
  redirect(KDS_ROUTES.fullscreen);
}
