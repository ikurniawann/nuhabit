import { redirect } from "next/navigation";

/** Legacy POS path — menu lives under Settings. */
export default function PosBillingSettingsRedirect() {
  redirect("/dashboard/settings/billing");
}
