import Link from "next/link";
import { ArrowRight, CalendarDays, Plus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatSiteDate, formatSiteTime } from "../lib/dates";
import { sessionHref, type PublicSession } from "../lib/timetable";
import type { Article, BranchSummary, HomeContent, PublicPlansView, SiteEvent, TrainingContent } from "../types";
import { ClassExplorer } from "./class-explorer";
import { HomeLatest, MemberStories, UpcomingSessions } from "./home-discovery";
import { MembershipSection } from "./membership-section";
import { PanelButton } from "./panel-button";
import { ArrowSquare, Container, Crosshair, FALLBACK_PHOTOS, Kicker, Picture, Section, SectionHeading, timetableHref } from "./site-section";

/** Full-bleed photo in a rounded frame that slides under the floating header. */
function Hero({ hero, pillars, branch, nextSession }: {
  hero: HomeContent["hero"];
  pillars: HomeContent["pillars"];
  branch: BranchSummary | null;
  nextSession: PublicSession | undefined;
}) {
  return (
    <section className="-mt-[4.75rem] px-3 md:px-4">
      <div className="relative isolate mx-auto flex min-h-[92dvh] flex-col justify-end overflow-hidden rounded-hero bg-ink text-on-ink">
        {hero.video_url ? (
          <video className="absolute inset-0 -z-10 h-full w-full object-cover" src={hero.video_url} poster={hero.image_url || undefined} autoPlay muted loop playsInline />
        ) : (
          <Picture src={hero.image_url || FALLBACK_PHOTOS.hero} alt="" className="absolute inset-0 -z-10 h-full w-full" />
        )}
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-ink via-ink/55 to-ink/10" />

        {pillars.length > 0 ? (
          <ul aria-label="Training pillars" className="absolute top-28 right-6 hidden flex-col items-end gap-2 md:flex lg:right-10">
            {pillars.slice(0, 3).map((pillar, i) => (
              <li key={`${pillar.code}-${i}`} className={cn("flex items-center gap-2 rounded-full bg-white/10 py-1.5 pr-4 pl-1.5 text-sm font-semibold ring-1 ring-white/15 backdrop-blur-md", i === 1 && "mr-10")}>
                <span className="flex size-6 items-center justify-center rounded-full bg-accent text-accent-foreground"><Plus className="size-3.5" /></span>
                {pillar.title}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="grid gap-8 p-6 pt-32 md:p-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end">
          <div className="space-y-5">
            {hero.kicker ? <p className="inline-block rounded-full bg-accent px-3 py-1 text-xs font-bold tracking-wider text-accent-foreground uppercase">{hero.kicker}</p> : null}
            <h1 className="max-w-4xl font-display text-4xl font-extrabold leading-[0.92] tracking-tight text-balance uppercase sm:text-6xl lg:text-7xl">{hero.title}</h1>
            {hero.subtitle ? <p className="max-w-xl text-base text-on-ink-muted md:text-lg">{hero.subtitle}</p> : null}
            <div className="flex flex-wrap gap-3 pt-2">
              <PanelButton panel="trial" size="lg" className="uppercase">
                {hero.cta_label || "Start a Trial"}
              </PanelButton>
              <Button asChild size="lg" variant="onInk" className="uppercase"><Link href={timetableHref()}>
                <CalendarDays /> Class timetable
              </Link></Button>
              <Button asChild variant="onInk" size="lg" className="uppercase">
                <Link href="/member/auth/login">
                  <UserRound /> Member login
                </Link>
              </Button>
            </div>
          </div>
          {nextSession && branch ? (
            <Link href={sessionHref(nextSession.id)} className="group block rounded-2xl bg-white/10 p-5 ring-1 ring-white/15 backdrop-blur-md transition-colors hover:bg-white/15">
              <p className="text-xs font-semibold tracking-wider text-accent uppercase">Next class · {branch.name}</p>
              <p className="mt-3 font-display text-5xl font-extrabold leading-none tabular-nums">{formatSiteTime(nextSession.starts_at)}</p>
              <p className="mt-2 font-display text-lg font-bold uppercase">{nextSession.class_type.name}</p>
              <p className="text-sm text-on-ink-muted">{formatSiteDate(nextSession.starts_at)} · {nextSession.duration_min} min</p>
              <p className="mt-4 flex items-center justify-between text-xs font-bold tracking-wider uppercase">
                {nextSession.seats_left > 0 ? `${nextSession.seats_left} seats left` : "View class"}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </p>
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** A lime band that scrolls the class and pillar names. */
function Ticker({ words }: { words: string[] }) {
  if (words.length === 0) return null;
  const run = [...words, ...words, ...words];
  return (
    <div className="px-3 pt-3 md:px-4">
      <div className=" overflow-hidden rounded-2xl bg-accent py-4 text-accent-foreground">
        <div aria-hidden className="flex w-max animate-[career-marquee_40s_linear_infinite] motion-reduce:animate-none">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex shrink-0 items-center">
              {run.map((word, i) => (
                <span key={`${copy}-${i}`} className="flex items-center gap-6 pr-6 font-display text-2xl font-extrabold tracking-tight uppercase md:text-3xl">
                  {word}
                  <Plus className="size-5" />
                </span>
              ))}
            </div>
          ))}
        </div>
        <p className="sr-only">{words.join(", ")}</p>
      </div>
    </div>
  );
}

function Partners({ partners }: { partners: HomeContent["partners"] }) {
  if (partners.length === 0) return null;
  return (
    <Container className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4 py-10">
      {partners.map((p) => (
        <span key={p.name} className="flex items-center gap-2 text-sm font-bold tracking-wider text-muted-foreground uppercase">
          {p.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.logo_url} alt={p.name} className="h-7 w-auto grayscale" loading="lazy" />
          ) : (
            p.name
          )}
        </span>
      ))}
    </Container>
  );
}

/** Editorial grid: label, photo and intro on the left; the method statement and next steps on the right. */
function Method({ training, branchSlug }: { training: TrainingContent; branchSlug?: string }) {
  const linkClass = "group h-auto justify-start gap-4 rounded-none p-0 font-display text-2xl font-extrabold tracking-tight uppercase hover:bg-transparent md:text-3xl";
  return (
    <Section>
      <Container>
        <div className="relative grid border border-border lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Crosshair className="-top-[5px] -left-[5px]" />
          <Crosshair className="-top-[5px] -right-[5px]" />
          <Crosshair className="-bottom-[5px] -left-[5px]" />
          <Crosshair className="-right-[5px] -bottom-[5px]" />
          <div className="flex flex-col border-b border-border lg:border-r lg:border-b-0">
            <div className="p-6 md:p-8">
              <Kicker>The method</Kicker>
              <p className="mt-2 max-w-[12rem] text-sm font-semibold tracking-wide uppercase">HYROX training club</p>
            </div>
            <div className="border-t border-border p-6 md:p-8">
              <div className="relative">
                <Picture src={FALLBACK_PHOTOS.method} alt="" className="notch aspect-[16/10] w-full grayscale sm:aspect-[2/1] lg:aspect-[4/5]" />
                <span aria-hidden className="absolute -bottom-3 -left-3 flex size-16 items-center justify-center bg-accent text-accent-foreground">
                  <Plus className="size-9" strokeWidth={3} />
                </span>
              </div>
            </div>
            {training.intro.text ? (
              <p className="mt-auto border-t border-border p-6 text-sm leading-6 font-medium uppercase md:p-8">{training.intro.text}</p>
            ) : null}
          </div>
          <div className="flex flex-col">
            <div className="flex flex-1 items-center p-6 md:p-12">
              <h2 className="font-display text-4xl font-extrabold leading-[0.9] tracking-tight text-balance uppercase sm:text-5xl md:text-7xl lg:text-8xl">
                {training.intro.title}
              </h2>
            </div>
            <div className="flex flex-col items-start gap-5 border-t border-border p-6 md:p-12">
              <PanelButton panel="trial" branchSlug={branchSlug} variant="ghost" className={linkClass}>
                Start a trial <ArrowSquare />
              </PanelButton>
              <Button asChild variant="ghost" className={linkClass}><Link href={timetableHref(branchSlug)}>
                See the timetable <ArrowSquare />
              </Link></Button>
              <Link href="/training" className={cn("inline-flex items-center", linkClass)}>
                How training works <ArrowSquare />
              </Link>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}

/** The 8-week block as a phase grid, then the numbers that frame it. */
function Block({ block, classCount, branchCount, fromPrice }: {
  block: TrainingContent["block"];
  classCount: number;
  branchCount: number;
  fromPrice: number | null;
}) {
  const stats = [
    { value: String(classCount), label: classCount === 1 ? "Class format" : "Class formats" },
    { value: String(block.phases.length), label: "Phases per block" },
    { value: String(branchCount), label: branchCount === 1 ? "Gym" : "Gyms" },
    { value: fromPrice ? formatRupiah(fromPrice) : "", label: "Plans from" },
  ].filter((stat) => stat.value && stat.value !== "0");
  if (block.phases.length === 0 && stats.length === 0) return null;
  return (
    <Section className="pt-0">
      <Container className="space-y-8">
        <SectionHeading kicker="Every session counts" title={block.title} text={block.text || undefined} />
        {block.phases.length > 0 ? (
          <ol className="relative grid border border-border sm:grid-cols-2 lg:grid-cols-4">
            <Crosshair className="-top-[5px] -left-[5px]" />
            <Crosshair className="-right-[5px] -bottom-[5px]" />
            {block.phases.map((phase, i) => (
              <li key={phase.name} className={cn("space-y-3 border-border p-6", i > 0 && "border-t sm:border-t-0", i % 2 === 1 && "sm:border-l", i > 1 && "sm:border-t lg:border-t-0", i > 0 && "lg:border-l")}>
                <p className="text-xs font-semibold tracking-wider text-forest uppercase dark:text-accent">{phase.weeks}</p>
                <h3 className="font-display text-xl font-extrabold uppercase">{phase.name}</h3>
                <p className="text-sm leading-6 text-body">{phase.text}</p>
              </li>
            ))}
          </ol>
        ) : null}
        {stats.length > 0 ? (
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stats.map((stat, i) => (
              <div key={stat.label} className={cn("notch flex min-h-40 min-w-0 flex-col justify-between p-5", i === 0 ? "bg-accent text-accent-foreground" : "bg-ink text-on-ink")}>
                <dd className={cn("font-display font-extrabold leading-none tracking-tight tabular-nums md:text-5xl", stat.value.length > 4 ? "text-2xl sm:text-4xl" : "text-4xl")}>{stat.value}</dd>
                <dt className={cn("mt-6 font-display text-sm font-bold tracking-wide uppercase", i === 0 ? "text-forest" : "text-accent")}>{stat.label}</dt>
              </div>
            ))}
          </dl>
        ) : null}
      </Container>
    </Section>
  );
}

/** Dark manifesto: the mission quote, then the pillars as cut-corner tiles. */
function Manifesto({ mission, pillars }: { mission: HomeContent["mission"]; pillars: HomeContent["pillars"] }) {
  if (!mission.quote && pillars.length === 0) return null;
  const [lead, ...rest] = mission.quote.split(/(?<=\.)\s+/);
  return (
    <section className="px-3 md:px-4">
      <div className="relative overflow-hidden rounded-hero bg-ink text-on-ink">
        {mission.quote ? (
          <div className="grid border-b border-white/10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <div className="flex flex-col justify-between gap-10 border-b border-white/10 p-6 md:border-r md:border-b-0 md:p-10">
              <Plus className="size-8 text-on-ink" strokeWidth={3} aria-hidden />
              <p className="text-sm font-semibold tracking-wide uppercase">Built for more than the gym.</p>
            </div>
            <figure className="p-6 md:p-12">
              <blockquote className="font-display text-2xl font-bold leading-tight uppercase md:text-4xl">
                {lead} {rest.length ? <span className="text-on-ink-muted">{rest.join(" ")}</span> : null}
              </blockquote>
              {mission.author ? <figcaption className="mt-6 text-xs font-semibold tracking-wider text-accent uppercase">{mission.author}</figcaption> : null}
            </figure>
          </div>
        ) : null}
        {pillars.length > 0 ? (
          <div className="grid gap-3 p-3 md:grid-cols-3 md:p-4">
            {pillars.map((pillar, i) => (
              <article key={`${pillar.code}-${i}`} className={cn("notch flex min-h-64 flex-col p-6", i % 2 === 0 ? "bg-accent text-accent-foreground" : "bg-card text-foreground")}>
                <p className="text-xs font-bold tracking-wider uppercase">{pillar.code}</p>
                <h3 className="mt-10 font-display text-3xl font-extrabold uppercase">{pillar.title}</h3>
                <p className={cn("mt-auto pt-6 text-sm leading-6", i % 2 === 0 ? "text-forest/85" : "text-body")}>{pillar.text}</p>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Reel({ reel }: { reel: HomeContent["reel"] }) {
  if (reel.length === 0) return null;
  const hasSamples = reel.some((item) => item.caption.startsWith("Sample photo:"));
  return (
    <Section>
      <Container className="space-y-6">
        <SectionHeading kicker={hasSamples ? "Sample content" : "Community"} title={hasSamples ? "Preview of the training gallery" : "What happens on the training floor"} text={hasSamples ? "AI-generated sample images. Replace them with approved photos from real classes." : undefined} />
        <ul className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 lg:-mx-6 lg:px-6">
          {reel.map((item, i) => (
            <li key={`${item.image_url}-${i}`} className="w-[78vw] shrink-0 snap-start sm:w-80">
              <figure className="overflow-hidden border border-border bg-card">
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

/** Closing split: a photo beside the gyms, each a row with an arrow. */
function Community({ branches }: { branches: BranchSummary[] }) {
  if (branches.length === 0) return null;
  const photo = branches.find((b) => b.hero_image_url)?.hero_image_url || FALLBACK_PHOTOS.community;
  return (
    <Section>
      <Container>
        <div className="relative grid border border-border lg:grid-cols-2">
          <Crosshair className="-top-[5px] -left-[5px]" />
          <Crosshair className="-right-[5px] -bottom-[5px]" />
          <div className="border-b border-border p-3 lg:border-r lg:border-b-0">
            <Picture src={photo} alt="" className="notch h-full min-h-80 w-full grayscale" />
          </div>
          <div className="flex flex-col p-6 md:p-12">
            <Kicker>Locations</Kicker>
            <h2 className="mt-3 font-display text-4xl font-extrabold leading-[0.92] tracking-tight uppercase md:text-5xl">Train alongside people who push you further.</h2>
            <ul className="mt-10 border-t border-border">
              {branches.slice(0, 4).map((b) => (
                <li key={b.slug} className="border-b border-border">
                  <Link href={`/locations/${b.slug}`} className="group flex items-center justify-between gap-4 py-4">
                    <span>
                      <span className="block font-display text-xl font-extrabold uppercase">{b.name}</span>
                      <span className="text-sm text-muted-foreground">{[b.address, b.city].filter(Boolean).join(", ")}</span>
                    </span>
                    <ArrowSquare />
                  </Link>
                </li>
              ))}
            </ul>
            <Link href="/locations" className="mt-6 inline-flex items-center gap-2 self-start text-sm font-bold tracking-wider text-forest uppercase underline-offset-4 hover:underline dark:text-accent">
              All locations <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </Container>
    </Section>
  );
}

export function HomePage({ home, branches, plans, training, sessions, selectedBranch, articles, events }: {
  home: HomeContent;
  branches: BranchSummary[];
  plans: PublicPlansView;
  training: TrainingContent;
  sessions: PublicSession[];
  selectedBranch: BranchSummary | null;
  articles: Article[];
  events: SiteEvent[];
}) {
  const branchSlug = selectedBranch?.slug;
  const prices = plans.plans.map((plan) => plan.price_idr).filter((price) => price > 0);
  const tickerWords = [...training.class_types.map((c) => c.name), ...home.pillars.map((p) => p.title)];
  return (
    <>
      <Hero hero={home.hero} pillars={home.pillars} branch={selectedBranch} nextSession={sessions[0]} />
      <Ticker words={tickerWords} />
      <Partners partners={home.partners} />
      <Method training={training} branchSlug={branchSlug} />
      {training.class_types.length > 0 ? (
        <Section className="pt-0">
          <Container className="space-y-8">
            <SectionHeading kicker="Classes" title="Master every station." text="Pick a class type to see what it trains." />
            <ClassExplorer classes={training.class_types} branchSlug={branchSlug} />
          </Container>
        </Section>
      ) : null}
      <UpcomingSessions branch={selectedBranch} sessions={sessions} />
      <Block block={training.block} classCount={training.class_types.length} branchCount={branches.length} fromPrice={prices.length ? Math.min(...prices) : null} />
      <Manifesto mission={home.mission} pillars={home.pillars} />
      <MemberStories stories={home.stories ?? []} />
      <Reel reel={home.reel} />
      <MembershipSection plans={plans} />
      <HomeLatest articles={articles} events={events} />
      <Community branches={branches} />
    </>
  );
}
