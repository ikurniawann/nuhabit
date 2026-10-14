import Link from "next/link";
import { ArrowRight, CalendarDays, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { stationHref } from "../lib/training";
import type { BranchSummary, ClassTypeContent, CoachContent, TrainingContent } from "../types";
import type { PublicSession } from "../lib/timetable";
import { UpcomingSessions } from "./home-discovery";
import { PanelButton } from "./panel-button";
import { ClassCard, CoachGrid, classPhoto, JoinBand } from "./training-parts";
import { Container, Crosshair, EmptyNote, FALLBACK_PHOTOS, Kicker, PageHero, Section, SectionHeading, timetableHref } from "./site-section";

type Phase = TrainingContent["block"]["phases"][number];

/** "Weeks 3-4" → [3, 4]; null when the label has no week numbers. */
function phaseWeeks(phase: Pick<Phase, "weeks">): [number, number] | null {
  const numbers = phase.weeks.match(/\d+/g)?.map(Number) ?? [];
  if (numbers.length === 0) return null;
  return [numbers[0], numbers[numbers.length - 1]];
}

/** The 8 weeks as a ruler with each phase as a band across its weeks. */
function BlockRuler({ phases }: { phases: Phase[] }) {
  const spans = phases.map(phaseWeeks);
  const total = Math.max(8, ...spans.map((span) => span?.[1] ?? 0));
  if (spans.some((span) => span === null)) return null;
  return (
    <div className="space-y-2" aria-hidden>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="border-t border-current/30 pt-1 text-[10px] font-semibold tracking-wider uppercase opacity-70">W{i + 1}</span>
        ))}
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
        {phases.map((phase, i) => {
          const [from, to] = spans[i] as [number, number];
          return (
            <span
              key={phase.name}
              style={{ gridColumn: `${from} / ${to + 1}` }}
              className={cn("truncate px-2 py-2 text-xs font-bold tracking-wide uppercase", i % 2 === 0 ? "bg-accent text-accent-foreground" : "bg-white/15")}
            >
              {phase.name.replace(/^Phase \d+:\s*/, "")}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function TrainingPage({ training }: { training: TrainingContent }) {
  const { intro, class_types: classTypes, block, laws, stations } = training;
  return (
    <>
      <PageHero kicker="Training" title={intro.title} text={intro.text} image={FALLBACK_PHOTOS.hero}>
        <PanelButton panel="trial" size="lg" className="uppercase">Start a trial</PanelButton>
        <Button asChild variant="ink" size="lg" className="uppercase">
          <Link href="/training/timetable"><CalendarDays /> Class timetable</Link>
        </Button>
      </PageHero>

      {classTypes.length > 0 ? (
        <Section className="pt-0">
          <Container className="space-y-8">
            <SectionHeading kicker="Classes" title="Pick your class." />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {classTypes.map((item, i) => <ClassCard key={`${item.name}-${i}`} item={item} index={i} />)}
            </div>
          </Container>
        </Section>
      ) : null}

      {block.phases.length > 0 ? (
        <section className="px-3 md:px-4">
          <div className=" space-y-8 rounded-hero bg-ink p-6 text-on-ink md:p-12">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <SectionHeading kicker="Program" title={block.title} text={block.text} onInk />
              <Button asChild variant="onInk" className="uppercase"><Link href="/training/block">The full block <ArrowRight /></Link></Button>
            </div>
            <BlockRuler phases={block.phases} />
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {block.phases.map((phase) => (
                <li key={phase.name} className="border border-white/10 p-5">
                  <p className="text-xs font-semibold tracking-wider text-accent uppercase">{phase.weeks}</p>
                  <h3 className="mt-2 font-display text-lg font-extrabold uppercase">{phase.name}</h3>
                  <p className="mt-2 text-sm text-on-ink-muted">{phase.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      ) : null}

      {stations.length > 0 ? (
        <Section>
          <Container className="space-y-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <SectionHeading kicker="HYROX" title="Eight stations to master." />
              <Button asChild variant="outline" className="uppercase"><Link href="/training/stations">Station guide <ArrowRight /></Link></Button>
            </div>
            <ol className="grid grid-cols-2 border-t border-l border-border md:grid-cols-4">
              {stations.map((station, i) => (
                <li key={station.name} className="border-r border-b border-border">
                  <Link href={stationHref(station)} className="block h-full p-4 transition-colors hover:bg-surface-2 md:p-5">
                    <p className="font-display text-3xl font-extrabold text-forest tabular-nums dark:text-accent">{String(i + 1).padStart(2, "0")}</p>
                    <p className="mt-3 font-display text-base font-extrabold uppercase md:text-lg">{station.name}</p>
                    {station.spec ? <p className="text-xs text-muted-foreground">{station.spec}</p> : null}
                  </Link>
                </li>
              ))}
            </ol>
          </Container>
        </Section>
      ) : null}

      {laws.items.length > 0 ? (
        <Section className={stations.length > 0 ? "pt-0" : undefined}>
          <Container className="space-y-8">
            <SectionHeading kicker="House rules" title={laws.title} />
            <ol className="grid border-t border-border md:grid-cols-2 md:gap-x-10">
              {laws.items.map((item, i) => (
                <li key={i} className="flex items-baseline gap-5 border-b border-border py-5">
                  <span className="font-display text-2xl font-extrabold text-forest tabular-nums dark:text-accent">{String(i + 1).padStart(2, "0")}</span>
                  <p className="text-body">{item}</p>
                </li>
              ))}
            </ol>
          </Container>
        </Section>
      ) : null}

      <JoinBand />
    </>
  );
}

export function TrainingBlockPage({ block }: { block: TrainingContent["block"] }) {
  return (
    <>
      <PageHero kicker="Training block" title={block.title} text={block.text} image={FALLBACK_PHOTOS.community} />
      {block.phases.length > 0 ? (
        <>
          <section className="px-3 md:px-4">
            <div className=" rounded-hero bg-ink p-6 text-on-ink md:p-10">
              <BlockRuler phases={block.phases} />
            </div>
          </section>
          <Section>
            <Container>
              <ol className="relative border border-border">
                <Crosshair className="-top-[5px] -left-[5px]" />
                <Crosshair className="-right-[5px] -bottom-[5px]" />
                {block.phases.map((phase, i) => (
                  <li key={phase.name} className="grid gap-4 border-b border-border p-6 last:border-b-0 md:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)] md:gap-8 md:p-10">
                    <p className="font-display text-6xl font-extrabold leading-none text-forest tabular-nums dark:text-accent">{String(i + 1).padStart(2, "0")}</p>
                    <div className="space-y-2">
                      <Kicker>{phase.weeks}</Kicker>
                      <h2 className="font-display text-3xl font-extrabold uppercase md:text-4xl">{phase.name}</h2>
                      <p className="text-body">{phase.text}</p>
                    </div>
                    {phase.items?.length ? (
                      <ul className="space-y-3 self-center">
                        {phase.items.map((item) => (
                          <li key={item} className="flex items-start gap-3 text-sm text-body">
                            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center bg-accent text-accent-foreground"><Plus className="size-3.5" /></span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ol>
            </Container>
          </Section>
        </>
      ) : (
        <Section className="pt-0"><Container><EmptyNote>The block plan is not published yet.</EmptyNote></Container></Section>
      )}
      <JoinBand title="Start week one with a trial." />
    </>
  );
}

export function ClassPage({ item, index, others, branch, sessions, coaches }: {
  item: ClassTypeContent;
  index: number;
  others: ClassTypeContent[];
  branch: BranchSummary | null;
  sessions: PublicSession[];
  coaches: CoachContent[];
}) {
  const facts = [
    { label: "Duration", value: item.duration },
    { label: "Level", value: item.level },
    { label: "Group size", value: sessions[0] ? `Up to ${sessions[0].capacity}` : "" },
  ].filter((fact) => fact.value);
  return (
    <>
      <PageHero kicker="Class" title={item.name} text={item.text} image={classPhoto(item, index)}>
        <Button asChild size="lg" className="uppercase"><Link href={timetableHref(branch?.slug)}><CalendarDays /> See class times</Link></Button>
        <PanelButton panel="trial" branchSlug={branch?.slug} variant="ink" size="lg" className="uppercase">Book a trial</PanelButton>
      </PageHero>
      {facts.length > 0 || item.focus?.length ? (
        <Section className="pt-0">
          <Container className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {facts.length > 0 ? (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
                {facts.map((fact, i) => (
                  <div key={fact.label} className={cn("notch flex min-h-32 flex-col justify-between p-5", i === 0 ? "bg-accent text-accent-foreground" : "bg-ink text-on-ink")}>
                    <dd className="font-display text-2xl font-extrabold uppercase md:text-3xl">{fact.value}</dd>
                    <dt className={cn("mt-4 text-xs font-bold tracking-wider uppercase", i === 0 ? "text-forest" : "text-accent")}>{fact.label}</dt>
                  </div>
                ))}
              </dl>
            ) : null}
            {item.focus?.length ? (
              <div className="border border-border p-6 md:p-8">
                <Kicker>What you train</Kicker>
                <ul className="mt-4 divide-y divide-border">
                  {item.focus.map((focus) => (
                    <li key={focus} className="flex items-center gap-3 py-3 font-display text-lg font-bold uppercase">
                      <Plus className="size-4 text-forest dark:text-accent" /> {focus}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Container>
        </Section>
      ) : null}
      <UpcomingSessions branch={branch} sessions={sessions} title={branch ? `${item.name} at ${branch.name}` : undefined} />
      {coaches.length > 0 ? (
        <Section className="pt-0">
          <Container className="space-y-6">
            <SectionHeading kicker="Coaches" title={`Who coaches ${item.name}`} />
            <CoachGrid coaches={coaches} />
          </Container>
        </Section>
      ) : null}
      {others.length > 0 ? (
        <Section className="pt-0">
          <Container className="space-y-6">
            <SectionHeading kicker="More classes" title="Mix your week." />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {others.map((other, i) => <ClassCard key={other.name} item={other} index={index + i + 1} />)}
            </div>
          </Container>
        </Section>
      ) : null}
      <JoinBand />
    </>
  );
}

export function FaqPage({ faq }: { faq: TrainingContent["faq"] }) {
  return (
    <>
      <PageHero kicker="FAQ" title="Questions, answered." text="Trials, credits, passes and race prep. Still unsure? Send us a message.">
        <Button asChild variant="ink" size="lg" className="uppercase"><Link href="/contact">Contact us</Link></Button>
      </PageHero>
      <Section className="pt-0">
        <Container className="max-w-4xl">
          {faq.length > 0 ? (
            <div className="border-t border-border">
              {faq.map((item, i) => (
                <details key={item.question} open={i === 0} className="group border-b border-border">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 [&::-webkit-details-marker]:hidden">
                    <span className="font-display text-lg font-extrabold uppercase md:text-xl">{item.question}</span>
                    <span className="flex size-8 shrink-0 items-center justify-center bg-accent text-accent-foreground transition-transform group-open:rotate-45"><Plus className="size-4" /></span>
                  </summary>
                  <p className="pb-6 leading-7 text-body">{item.answer}</p>
                </details>
              ))}
            </div>
          ) : (
            <EmptyNote>No questions published yet.</EmptyNote>
          )}
        </Container>
      </Section>
      <JoinBand />
    </>
  );
}
