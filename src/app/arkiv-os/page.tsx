import { redirect } from "next/navigation";
import { legacyOsRedirectTarget } from "@/lib/desktop/deep-link";

/** Alamat lama (bookmark, tautan WA/e-mail lama) → /os dengan query utuh. */
export default async function LegacyArkivOsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(legacyOsRedirectTarget(await searchParams));
}
