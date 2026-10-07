import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BranchSummary, HomeContent, PublicPlansView } from "../types";
import { MembershipSection } from "./membership-section";
import { PanelButton } from "./panel-button";
import { Container, Kicker, Picture, Section, SectionHeading, Tile } from "./site-section";

function Hero({ hero }: { hero: HomeContent["hero"] }) {
  return (
    <section className="relative isolate overflow-hidden bg-ink text-on-ink">
      {hero.video_url ? (
        <video
          className="absolute inset-0 -z-10 h-full w-full object-cover opacity-40"
          src={hero.video_url}
          poster={hero.image_url || undefined}
          autoPlay
          muted
          loop
          playsInline
        />
      ) : hero.image_url ? (
        <Picture src={hero.image_url} alt="" className="absolute inset-0 -z-10 h-full w-full opacity-40" />
      ) : (
        <div aria-hidden className="pointer-events-none absolute -top-32 -right-32 -z-10 size-96 rounded-full bg-accent/25 blur-3xl" />
      )}
      <Container className="flex min-h-[70dvh] flex-col justify-end gap-6 py-16 md:min-h-[78dvh] md:py-24">
        <div className="max-w-3xl space-y-4">
          {hero.kicker ? <Kicker onInk>{hero.kicker}</Kicker> : null}
          <h1 className="font-display text-4xl font-bold tracking-tight text-balance sm:text-5xl md:text-6xl">{hero.title}</h1>
          {hero.subtitle ? <p className="max-w-xl text-base text-on-ink-muted md:text-lg">{hero.subtitle}</p> : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <PanelButton panel="trial" size="lg">
            {hero.cta_label || "Start a Trial"}
          </PanelButton>
          <PanelButton panel="timetable" size="lg" variant="onInk">
            <CalendarDays /> Class timetable
          </PanelButton>
          <Button asChild variant="onInk" size="lg">
            <Link href="/locations">
              <MapPin /> Find a gym
            </Link>
          </Button>
        </div>
      </Container>
    </section>
  );
}

function Partners({ partners }: { partners: HomeContent["partners"] }) {
  if (partners.length === 0) return null;
  return (
    <div className="border-b border-border/60 bg-surface">
      <Container className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 py-6">
        {partners.map((p) => (
          <span key={p.name} className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            {p.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.logo_url} alt={p.name} className="h-7 w-auto" loading="lazy" />
            ) : (
              p.name
            )}
          </span>
        ))}
      </Container>
    </div>
  );
}

function Pillars({ pillars }: { pillars: HomeContent["pillars"] }) {
  if (pillars.length === 0) return null;
  return (
    <Section>
      <Container className="space-y-8">
        <SectionHeading kicker="Method" title="The three pillars of NüHabit training" />
        <div className="space-y-3">
          {pillars.map((p, i) => (
            <details key={`${p.code}-${i}`} open={i === 0} className="group rounded-card bg-card shadow-card">
              <summary className="flex cursor-pointer list-none items-center gap-4 px-6 py-5 [&::-webkit-details-marker]:hidden">
                <span className="font-display text-sm font-bold tracking-wider text-forest uppercase dark:text-accent">{p.code}</span>
                <span className="font-display text-xl font-semibold">{p.title}</span>
                <ArrowRight className="ml-auto size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
              </summary>
              <p className="px-6 pb-6 text-body">{p.text}</p>
            </details>
          ))}
        </div>
      </Container>
    </Section>
  );
}

function Mission({ mission }: { mission: HomeContent["mission"] }) {
  if (!mission.quote) return null;
  return (
    <Section className="py-0">
      <Container>
        <figure className="rounded-hero bg-accent px-6 py-12 text-accent-foreground shadow-glow md:px-16 md:py-20">
          <blockquote className="font-display max-w-3xl text-2xl font-semibold text-balance md:text-4xl">“{mission.quote}”</blockquote>
          {mission.author ? <figcaption className="mt-6 text-sm font-semibold">{mission.author}</figcaption> : null}
        </figure>
      </Container>
    </Section>
  );
}

function Reel({ reel }: { reel: HomeContent["reel"] }) {
  if (reel.length === 0) return null;
  return (
    <Section>
      <Container className="space-y-6">
        <SectionHeading kicker="Community" title="What happens on the training floor" />
        <ul className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 lg:-mx-6 lg:px-6">
          {reel.map((item, i) => (
            <li key={`${item.image_url}-${i}`} className="w-[78vw] shrink-0 snap-start sm:w-80">
              <figure className="overflow-hidden rounded-card bg-card shadow-card">
                <Picture src={item.image_url} alt={item.caption} className="aspect-[4/5] w-full" />
                {item.caption ? <figcaption className="px-4 py-3 text-sm text-body">{item.caption}</figcaption> : null}
              </figure>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}

function Branches({ branches }: { branches: BranchSummary[] }) {
  if (branches.length === 0) return null;
  return (
    <Section>
      <Container className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading kicker="Locations" title="Our gyms" />
          <Button asChild variant="outline">
            <Link href="/locations">All locations</Link>
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {branches.slice(0, 3).map((b) => (
            <Link key={b.slug} href={`/locations/${b.slug}`} className="group">
              <Tile className="h-full space-y-2 transition-shadow group-hover:shadow-float">
                <Picture src={b.hero_image_url} alt="" className="-mx-6 -mt-6 mb-4 aspect-[3/2] w-[calc(100%+3rem)] max-w-none rounded-t-card" />
                <h3 className="font-display text-lg font-semibold">{b.name}</h3>
                <p className="text-sm text-muted-foreground">{[b.city, b.postcode].filter(Boolean).join(" ")}</p>
              </Tile>
            </Link>
          ))}
        </div>
      </Container>
    </Section>
  );
}

export function HomePage({ home, branches, plans }: { home: HomeContent; branches: BranchSummary[]; plans: PublicPlansView }) {
  return (
    <>
      <Hero hero={home.hero} />
      <Partners partners={home.partners} />
      <Pillars pillars={home.pillars} />
      <Mission mission={home.mission} />
      <MembershipSection plans={plans} />
      <Reel reel={home.reel} />
      <Branches branches={branches} />
    </>
  );
}
