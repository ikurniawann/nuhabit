"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Crosshair, LoaderCircle, MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMyLocation } from "@/features/member-app/lib/geolocation";
import { formatKm, sortByDistance, type LatLng } from "../lib/distance";
import type { BranchSummary } from "../types";
import { BranchMap, type MapPin as Pin } from "./branch-map";
import { Container, EmptyNote, Picture, Section, SectionHeading } from "./site-section";

const noSubscribe = () => () => {};

/** False during server rendering and hydration; the map needs a real DOM. */
function useMounted(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}

function matches(branch: BranchSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [branch.name, branch.city, branch.postcode].some((v) => v?.toLowerCase().includes(q));
}

export function LocationsPage({ branches }: { branches: BranchSummary[] }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const mounted = useMounted();
  const me = useMyLocation();
  const fix = me.fix;
  const origin = useMemo<LatLng | null>(() => (fix ? { lat: fix.lat, lng: fix.lng } : null), [fix]);

  const ranked = useMemo(() => {
    const filtered = branches.filter((b) => matches(b, query));
    if (!origin) return filtered.map((item) => ({ item, km: null as number | null }));
    return sortByDistance(filtered, origin);
  }, [branches, query, origin]);

  const pins: Pin[] = useMemo(
    () =>
      ranked
        .filter(({ item }) => item.lat !== null && item.lng !== null)
        .map(({ item }) => ({ slug: item.slug, label: item.name, lat: item.lat!, lng: item.lng! })),
    [ranked],
  );

  return (
    <Section>
      <Container className="space-y-8">
        <SectionHeading as="h1" kicker="Locations" title="Find your nearest NüHabit" text="Every branch runs the same program and the same standard of space." />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
            <span className="sr-only">Search by branch name, city or postcode</span>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Branch name, city or postcode"
              className="h-11 rounded-full pl-11"
            />
          </label>
          <Button variant="ink" className="h-11" disabled={me.locating} onClick={() => void me.request()}>
            {me.locating ? <LoaderCircle className="animate-spin" /> : <Crosshair />}
            Use my location
          </Button>
        </div>
        {me.error ? <p className="text-sm text-danger">{me.error}</p> : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="space-y-3 lg:order-2">
            {pins.length > 0 ? (
              mounted ? (
                <BranchMap pins={pins} me={origin} selected={selected} onSelect={setSelected} />
              ) : (
                <div className="h-[360px] animate-pulse rounded-card bg-surface-2" />
              )
            ) : null}
          </div>
          <ul className="space-y-3 lg:order-1">
            {ranked.length === 0 ? (
              <li>
                <EmptyNote>{branches.length === 0 ? "No branches published yet." : "No branches match your search."}</EmptyNote>
              </li>
            ) : (
              ranked.map(({ item, km }) => (
                <li key={item.slug}>
                  <article
                    onClick={() => setSelected(item.slug)}
                    className={`flex gap-4 rounded-card bg-card p-4 shadow-card transition-shadow ${selected === item.slug ? "ring-2 ring-forest" : ""}`}
                  >
                    <Picture src={item.hero_image_url} alt="" className="size-20 shrink-0 rounded-2xl" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <h2 className="font-display text-lg font-semibold">{item.name}</h2>
                        {km !== null ? <span className="shrink-0 rounded-full bg-accent-strong px-2.5 py-0.5 text-xs font-bold text-accent-foreground">{formatKm(km)}</span> : null}
                      </div>
                      <p className="mt-0.5 flex items-start gap-1.5 text-sm text-body">
                        <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span>{[item.address, item.city, item.postcode].filter(Boolean).join(", ") || "Address coming soon"}</span>
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button asChild size="sm">
                          <Link href={`/locations/${item.slug}`}>View branch</Link>
                        </Button>
                        {item.phone ? (
                          <Button asChild size="sm" variant="outline">
                            <a href={`tel:${item.phone.replace(/\s+/g, "")}`}>Call</a>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </article>
                </li>
              ))
            )}
          </ul>
        </div>
      </Container>
    </Section>
  );
}
