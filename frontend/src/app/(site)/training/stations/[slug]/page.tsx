import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StationPage } from "@/features/site/components/training-profiles";
import { fetchContent } from "@/features/site/lib/public-api";
import { findBySlug } from "@/features/site/lib/training";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { item } = findBySlug((await fetchContent("training")).stations, (await params).slug);
  return { title: item ? `${item.name}, HYROX station` : "Station" };
}

export default async function Page({ params }: Props) {
  const training = await fetchContent("training");
  const { item: station, index } = findBySlug(training.stations, (await params).slug);
  if (!station) notFound();
  const stationClass = findBySlug(training.class_types, "station");
  return (
    <StationPage
      station={station}
      index={index}
      stations={training.stations}
      stationClass={stationClass.item ? { item: stationClass.item, index: stationClass.index } : null}
    />
  );
}
