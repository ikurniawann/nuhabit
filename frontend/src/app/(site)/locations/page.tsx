import type { Metadata } from "next";
import { LocationsPage } from "@/features/site/components/locations-page";
import { fetchBranches } from "@/features/site/lib/public-api";

export const metadata: Metadata = { title: "Lokasi" };

export default async function Page() {
  return <LocationsPage branches={await fetchBranches()} />;
}
