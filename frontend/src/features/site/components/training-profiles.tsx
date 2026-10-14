import Link from "next/link";
import { ArrowLeft, ArrowRight, AtSign, CalendarDays, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { classHref, stationHref } from "../lib/training";
import type { ClassTypeContent, CoachContent, StationContent } from "../types";
import { SessionSchedule, type ScheduledSession } from "./session-schedule";
import { PanelButton } from "./panel-button";
import { ClassCard, CoachGrid, CoachPhoto, JoinBand } from "./training-parts";
import { Container, Crosshair, EmptyNote, FALLBACK_PHOTOS, Kicker, PageHero, Picture, Section, SectionHeading, timetableHref } from "./site-section";

function instagramHref(handle: string): string {
  return handle.startsWith("http") ? handle : `https://instagram.com/${handle.replace(/^@/, "")}`;
}

export function CoachesPage({ coaches }: { coaches: CoachContent[] }) {
  return (
    <>
      <PageHero kicker="Coaches" title="The people on the floor." text="Every class runs with a coach who knows your name, your numbers and the plan for the week." />
      <Section className="pt-0">
        <Container>{coaches.length > 0 ? <CoachGrid coaches={coaches} /> : <EmptyNote>Coach profiles are not published yet.</EmptyNote>}</Container>
      </Section>
      <JoinBand title="Train with them this week." />
    </>
  );
}

/** One coach: profile on the left, facts and lists on the right, then their two-week schedule. */
export function CoachPage({ coach, sessions, classes, others }: {
  coach: CoachContent;
  sessions: ScheduledSession[];
  /** Class types this coach has on the timetable, with their index in the training content. */
  classes: { item: ClassTypeContent; index: number }[];
  others: CoachContent[];
}) {
  const branchCount = new Set(sessions.map((s) => s.branch.slug)).size;
  const stats = [
    { value: String(sessions.length), label: sessions.length === 1 ? "Class in 2 weeks" : "Classes in 2 weeks" },
    { value: String(classes.length), label: classes.length === 1 ? "Class type" : "Class types" },
    { value: String(branchCount), label: branchCount === 1 ? "Branch" : "Branches" },
  ];
  return (
    <>
      <Section className="pb-8 md:pb-10">
        <Container>
          <div className="relative grid border border-border lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <Crosshair className="-top-[5px] -left-[5px]" />
            <Crosshair className="-right-[5px] -bottom-[5px]" />
            <div className="border-b border-border p-3 lg:border-r lg:border-b-0">
              <CoachPhoto coach={coach} className="aspect-[4/5] sm:aspect-[21/9] lg:aspect-[4/5]" />
            </div>
            <div className="flex flex-col gap-6 p-6 md:p-10 lg:p-12">
              <Link href="/training/coaches" className="inline-flex items-center gap-2 self-start text-xs font-bold tracking-wider text-muted-foreground uppercase hover:text-foreground">
                <ArrowLeft className="size-3.5" /> All coaches
              </Link>
              <div className="space-y-3">
                {coach.role ? <Kicker>{coach.role}</Kicker> : null}
                <h1 className="font-display text-4xl font-extrabold leading-[0.92] tracking-tight uppercase sm:text-6xl lg:text-7xl">{coach.name}</h1>
              </div>
              {coach.quote ? <blockquote className="border-l-4 border-accent pl-4 font-display text-xl font-bold uppercase md:text-2xl">“{coach.quote}”</blockquote> : null}
              {coach.bio ? <p className="max-w-2xl text-base leading-7 text-body md:text-lg">{coach.bio}</p> : null}
              {coach.specialties?.length ? (
                <ul aria-label="Specialties" className="flex flex-wrap gap-2">
                  {coach.specialties.map((item) => (
                    <li key={item} className="bg-accent px-3 py-1.5 text-xs font-bold tracking-wider text-accent-foreground uppercase">{item}</li>
                  ))}
                </ul>
              ) : null}
              {coach.certifications?.length ? (
                <div>
                  <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Certifications</p>
                  <ul className="mt-2 space-y-1.5">
                    {coach.certifications.map((item) => (
                      <li key={item} className="flex items-center gap-2 text-sm text-body"><Plus className="size-3.5 text-forest dark:text-accent" /> {item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="mt-auto flex flex-wrap gap-3 pt-2">
                <PanelButton panel="trial" size="lg" className="uppercase">Book a trial</PanelButton>
                <Button asChild variant="ink" size="lg" className="uppercase">
                  <a href="#schedule"><CalendarDays /> See schedule</a>
                </Button>
                {coach.instagram ? (
                  <Button asChild variant="outline" size="lg">
                    <a href={instagramHref(coach.instagram)} target="_blank" rel="noopener noreferrer"><AtSign /> {coach.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//, "@")}</a>
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </Container>
      </Section>

      <Section className="pt-0">
        <Container>
          <dl className="grid grid-cols-3 gap-3">
            {stats.map((stat, i) => (
              <div key={stat.label} className={cn("notch flex min-h-32 flex-col justify-between p-4 md:p-5", i === 0 ? "bg-accent text-accent-foreground" : "bg-ink text-on-ink")}>
                <dd className="font-display text-4xl font-extrabold leading-none tabular-nums md:text-5xl">{stat.value}</dd>
                <dt className={cn("mt-4 text-[11px] font-bold tracking-wider uppercase md:text-xs", i === 0 ? "text-forest" : "text-accent")}>{stat.label}</dt>
              </div>
            ))}
          </dl>
        </Container>
      </Section>

      <Section id="schedule" className="scroll-mt-24 pt-0">
        <Container className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <SectionHeading kicker="Schedule" title={`Train with ${coach.name.split(" ")[0]}`} text="The next two weeks. Times shown in Western Indonesia Time (WIB)." />
            <Button asChild variant="outline" className="uppercase"><Link href={timetableHref()}>Full timetable <ArrowRight /></Link></Button>
          </div>
          <SessionSchedule sessions={sessions} />
        </Container>
      </Section>

      {classes.length > 0 ? (
        <Section className="pt-0">
          <Container className="space-y-6">
            <SectionHeading kicker="Classes" title="Classes they coach" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {classes.map(({ item, index }) => <ClassCard key={item.name} item={item} index={index} />)}
            </div>
          </Container>
        </Section>
      ) : null}

      {others.length > 0 ? (
        <Section className="pt-0">
          <Container className="space-y-6">
            <SectionHeading kicker="The team" title="More coaches" />
            <CoachGrid coaches={others} />
          </Container>
        </Section>
      ) : null}
      <JoinBand title={`Book your first class with ${coach.name.split(" ")[0]}.`} />
    </>
  );
}

export function StationsPage({ stations }: { stations: StationContent[] }) {
  return (
    <>
      <PageHero
        kicker="HYROX stations"
        title="Eight runs. Eight stations."
        text="A HYROX race alternates 1 km of running with one workout station, eight times. Learn each station in class before race day."
        image={FALLBACK_PHOTOS.classes[1]}
      />
      <Section className="pt-0">
        <Container>
          {stations.length > 0 ? (
            <ol className="relative border border-border">
              <Crosshair className="-top-[5px] -left-[5px]" />
              <Crosshair className="-right-[5px] -bottom-[5px]" />
              {stations.map((station, i) => (
                <li key={station.name} className="border-b border-border last:border-b-0">
                  <p className="flex items-center gap-3 bg-surface-2 px-6 py-2 text-xs font-bold tracking-wider text-muted-foreground uppercase md:px-10">
                    <ArrowRight className="size-3.5" /> Run {i + 1} · 1 km
                  </p>
                  <Link href={stationHref(station)} className="group grid gap-4 p-6 transition-colors hover:bg-surface-2 md:grid-cols-[6rem_minmax(0,1fr)_auto] md:items-center md:gap-8 md:p-10">
                    <p className="font-display text-5xl font-extrabold leading-none text-forest tabular-nums dark:text-accent">{String(i + 1).padStart(2, "0")}</p>
                    <div className="space-y-2">
                      <h2 className="font-display text-2xl font-extrabold uppercase md:text-4xl">{station.name}</h2>
                      {station.spec ? <p className="inline-block bg-accent px-2.5 py-1 text-xs font-bold tracking-wider text-accent-foreground uppercase">{station.spec}</p> : null}
                      {station.text ? <p className="max-w-2xl text-body">{station.text}</p> : null}
                    </div>
                    <span className="inline-flex items-center gap-2 text-xs font-bold tracking-wider uppercase">
                      Technique <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyNote>The station guide is not published yet.</EmptyNote>
          )}
        </Container>
      </Section>
      <JoinBand title="Learn every station with a coach." />
    </>
  );
}

function StationLink({ station, number, direction }: { station: StationContent; number: number; direction: "prev" | "next" }) {
  return (
    <Link href={stationHref(station)} className={cn("group flex flex-col gap-2 border border-border p-5 transition-colors hover:border-forest/40 md:p-6", direction === "next" && "sm:items-end sm:text-right")}>
      <span className="inline-flex items-center gap-2 text-xs font-bold tracking-wider text-muted-foreground uppercase">
        {direction === "prev" ? <><ArrowLeft className="size-3.5" /> Station {number}</> : <>Station {number} <ArrowRight className="size-3.5" /></>}
      </span>
      <span className="font-display text-2xl font-extrabold uppercase">{station.name}</span>
    </Link>
  );
}

/** One station: spec, what it is, technique tips and the stations either side of it. */
export function StationPage({ station, index, stations, stationClass }: {
  station: StationContent;
  index: number;
  stations: StationContent[];
  /** The class that drills the stations, when there is one. */
  stationClass: { item: ClassTypeContent; index: number } | null;
}) {
  const prev = stations[index - 1];
  const next = stations[index + 1];
  return (
    <>
      <PageHero kicker={`Station ${index + 1} of ${stations.length}`} title={station.name} text={station.text} image={station.image_url || undefined}>
        {station.spec ? <p className="bg-accent px-3 py-2 text-sm font-bold tracking-wider text-accent-foreground uppercase">{station.spec}</p> : null}
        <p className="border border-border px-3 py-2 text-sm font-bold tracking-wider uppercase">After run {index + 1} · 1 km</p>
      </PageHero>

      <Section className="pt-0">
        <Container className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="border border-border p-6 md:p-10">
            <Kicker>Technique</Kicker>
            {station.tips?.length ? (
              <ol className="mt-4 divide-y divide-border">
                {station.tips.map((tip, i) => (
                  <li key={tip} className="flex items-baseline gap-5 py-4">
                    <span className="font-display text-2xl font-extrabold text-forest tabular-nums dark:text-accent">{String(i + 1).padStart(2, "0")}</span>
                    <p className="text-body md:text-lg">{tip}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-4 text-body">Your coach walks you through this station in class.</p>
            )}
          </div>
          {stationClass ? (
            <div className="notch flex flex-col justify-between gap-8 bg-ink p-6 text-on-ink md:p-10">
              <div className="space-y-3">
                <p className="text-xs font-semibold tracking-wider text-accent uppercase">Where you train it</p>
                <h2 className="font-display text-3xl font-extrabold uppercase md:text-4xl">{stationClass.item.name}</h2>
                <p className="text-sm text-on-ink-muted">{stationClass.item.text}</p>
              </div>
              <div className="flex items-center gap-4">
                <Picture src={stationClass.item.image_url || FALLBACK_PHOTOS.classes[stationClass.index % FALLBACK_PHOTOS.classes.length]} alt="" className="size-20 shrink-0 grayscale" />
                <Button asChild className="uppercase"><Link href={classHref(stationClass.item)}>About the class <ArrowRight /></Link></Button>
              </div>
            </div>
          ) : null}
        </Container>
      </Section>

      <Section className="pt-0">
        <Container className="grid gap-3 sm:grid-cols-2">
          {prev ? <StationLink station={prev} number={index} direction="prev" /> : <span className="hidden sm:block" />}
          {next ? <StationLink station={next} number={index + 2} direction="next" /> : (
            <Link href="/training/stations" className="group flex flex-col gap-2 border border-border p-5 transition-colors hover:border-forest/40 sm:items-end sm:text-right md:p-6">
              <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Finish line</span>
              <span className="font-display text-2xl font-extrabold uppercase">All stations</span>
            </Link>
          )}
        </Container>
      </Section>
      <JoinBand title="Learn every station with a coach." />
    </>
  );
}
