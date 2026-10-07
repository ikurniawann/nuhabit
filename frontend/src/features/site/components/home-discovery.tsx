import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatSiteDate, formatSiteTime } from "../lib/dates";
import { sessionHref, type PublicSession } from "../lib/timetable";
import type { Article, BranchSummary, HomeContent, SiteEvent, TrainingContent } from "../types";
import { PanelButton } from "./panel-button";
import { Container, Picture, Section, SectionHeading, Tile } from "./site-section";

export function FirstSession({ training, branch, sessions }: {
  training: TrainingContent;
  branch: BranchSummary | null;
  sessions: PublicSession[];
}) {
  const classes = training.class_types.slice(0, 3);
  return (
    <>
      <Section className="bg-surface">
        <Container className="space-y-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <SectionHeading kicker="Your first step" title="Find a class that fits you" text={training.intro.text || "Explore the classes and start with a trial session."} />
            <Button asChild variant="outline"><Link href="/training">How training works <ArrowRight className="size-4" /></Link></Button>
          </div>
          {classes.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-3">
              {classes.map((item) => (
                <Tile key={item.name} className="flex h-full flex-col gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-forest dark:text-accent">{item.duration}</p>
                  <h3 className="font-display text-xl font-semibold">{item.name}</h3>
                  <p className="flex-1 text-sm leading-6 text-body">{item.text}</p>
                  <PanelButton panel="timetable" branchSlug={branch?.slug} variant="link" className="self-start px-0">See class times <ArrowRight className="size-4" /></PanelButton>
                </Tile>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-card bg-ink px-6 py-5 text-on-ink">
            <div>
              <h3 className="font-display text-lg font-semibold">Try a session before choosing a plan.</h3>
              <p className="mt-1 text-sm text-on-ink-muted">Pick a branch, meet a coach and see how the class feels.</p>
            </div>
            <PanelButton panel="trial" branchSlug={branch?.slug}>Start a Trial</PanelButton>
          </div>
        </Container>
      </Section>
      {branch ? (
        <Section className="pt-0 bg-surface">
          <Container className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <SectionHeading kicker="Coming up" title={`Classes at ${branch.name}`} text="Times shown in Western Indonesia Time (WIB)." />
              <PanelButton panel="timetable" branchSlug={branch.slug} variant="outline"><CalendarDays className="size-4" /> Full timetable</PanelButton>
            </div>
            {sessions.length > 0 ? (
              <ul className="grid gap-3 md:grid-cols-3">
                {sessions.map((session) => (
                  <li key={session.id}>
                    <Link href={sessionHref(session.id)} className="group block h-full rounded-card bg-card p-5 shadow-card transition-shadow hover:shadow-float focus-visible:outline-2 focus-visible:outline-forest" aria-label={`View ${session.class_type.name} on ${formatSiteDate(session.starts_at)} at ${formatSiteTime(session.starts_at)}`}>
                    <p className="text-xs font-semibold uppercase tracking-wider text-forest dark:text-accent">{formatSiteDate(session.starts_at)} · {formatSiteTime(session.starts_at)}</p>
                    <h3 className="mt-2 font-display text-lg font-semibold">{session.class_type.name}</h3>
                    <p className="mt-1 text-sm text-body">{session.duration_min} min{session.coach_name ? ` · Coach ${session.coach_name}` : ""}</p>
                    <p className="mt-3 text-xs font-semibold text-muted-foreground">{session.seats_left > 0 ? `${session.seats_left} seats left` : session.waitlist_open ? "Waitlist open" : "Full"}</p>
                    <p className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-forest dark:text-accent">View class <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" /></p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-card bg-card px-5 py-4 text-sm text-body">No upcoming classes are published for this branch yet. Open the timetable to check another week or branch.</p>
            )}
          </Container>
        </Section>
      ) : null}
    </>
  );
}

export function MemberStories({ stories }: { stories: HomeContent["stories"] }) {
  const published = stories.filter((story) => story.name.trim() && story.quote.trim());
  if (published.length === 0) return null;
  const hasSamples = published.some((story) => story.role === "Sample story");
  return (
    <Section className="bg-surface">
      <Container className="space-y-6">
        <SectionHeading kicker={hasSamples ? "Sample content" : "Member stories"} title={hasSamples ? "Preview of member stories" : "Progress, in their own words"} text={hasSamples ? "The examples below are fictional. Replace them with approved member quotes before publishing." : undefined} />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {published.slice(0, 3).map((story, index) => (
            <figure key={`${story.name}-${index}`} className="overflow-hidden rounded-card bg-card shadow-card">
              {story.image_url ? <Picture src={story.image_url} alt={story.name} className="aspect-[4/3] w-full" /> : null}
              <div className="p-6">
                {story.role === "Sample story" ? <p className="mb-3 inline-block rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">Sample story</p> : null}
                {story.outcome ? <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-forest dark:text-accent">{story.outcome}</p> : null}
                <blockquote className="text-base leading-7 text-body">“{story.quote}”</blockquote>
                <figcaption className="mt-5 text-sm font-semibold">{story.name}{story.role && story.role !== "Sample story" ? <span className="font-normal text-muted-foreground"> · {story.role}</span> : null}</figcaption>
              </div>
            </figure>
          ))}
        </div>
      </Container>
    </Section>
  );
}

export function HomeLatest({ articles, events }: { articles: Article[]; events: SiteEvent[] }) {
  return (
    <Section>
      <Container className="space-y-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading kicker="What's happening" title="More from NüHabit" />
          {articles.length > 0 ? <Button asChild variant="outline"><Link href="/news">All stories <ArrowRight className="size-4" /></Link></Button> : null}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {events.map((event) => (
            <Link key={event.id} href={`/events/${event.slug}`} className="group block overflow-hidden rounded-card bg-card shadow-card transition-shadow hover:shadow-float">
              {event.cover_image_url ? <Picture src={event.cover_image_url} alt="" className="aspect-[16/10] w-full" /> : null}
              <div className="p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-forest dark:text-accent">Upcoming event · {formatSiteDate(event.starts_at)}</p>
                <h3 className="mt-2 font-display text-lg font-semibold">{event.title}</h3>
                {event.location_text ? <p className="mt-2 flex items-center gap-1 text-sm text-body"><MapPin className="size-4" />{event.location_text}</p> : null}
                <p className="mt-4 text-sm font-semibold text-forest dark:text-accent">View event <ArrowRight className="inline size-4" /></p>
              </div>
            </Link>
          ))}
          {articles.map((article) => (
            <Link key={article.id} href={`/news/${article.slug}`} className="group block overflow-hidden rounded-card bg-card shadow-card transition-shadow hover:shadow-float">
              {article.cover_image_url ? <Picture src={article.cover_image_url} alt="" className="aspect-[16/10] w-full" /> : null}
              <div className="p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-forest dark:text-accent">From the journal</p>
                <h3 className="mt-2 font-display text-lg font-semibold">{article.title}</h3>
                {article.excerpt ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-body">{article.excerpt}</p> : null}
                <p className="mt-4 text-sm font-semibold text-forest dark:text-accent">Read story <ArrowRight className="inline size-4" /></p>
              </div>
            </Link>
          ))}
          <Link href="/apparel" className="group flex flex-col justify-between rounded-card bg-ink p-6 text-on-ink transition-shadow hover:shadow-float">
            <ShoppingBag className="size-7 text-accent" />
            <div className="mt-12">
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">NüHabit Shop</p>
              <h3 className="mt-2 font-display text-xl font-semibold">Gear for training days and everything after.</h3>
              <p className="mt-4 text-sm font-semibold">Explore the shop <ArrowRight className="inline size-4" /></p>
            </div>
          </Link>
        </div>
      </Container>
    </Section>
  );
}
