import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JoinStatus } from "@/features/site/components/join-status";

export const metadata: Metadata = { title: "Status pembelian" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { searchParams: Promise<{ purchase?: string }> };

export default async function Page({ searchParams }: Props) {
  const { purchase } = await searchParams;
  if (!purchase || !UUID.test(purchase)) notFound();
  return <JoinStatus purchaseId={purchase} />;
}
