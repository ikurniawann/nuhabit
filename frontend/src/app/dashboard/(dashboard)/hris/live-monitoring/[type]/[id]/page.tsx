import { notFound } from "next/navigation";
import { LiveMonitorDetailPage } from "@/features/hris/live-monitoring";

export const metadata = { title: "Live Monitoring" };

export default async function Page({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const { type, id } = await params;
  if (type !== "psikotes" && type !== "interview") notFound();
  return <LiveMonitorDetailPage type={type} sessionId={id} />;
}
