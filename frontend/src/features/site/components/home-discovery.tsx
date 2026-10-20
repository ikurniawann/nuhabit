import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatSiteDate, formatSiteTime } from "../lib/dates";
import { sessionHref, type PublicSession } from "../lib/timetable";
import { cn } from "@/lib/utils";
import type { Article, BranchSummary, HomeContent, SiteEvent } from "../types";
import { ArrowSquare, Container, Picture, Section, SectionHeading, timetableHref } from "./site-section";

/** The next classes at the remembered branch as tiles, the first in lime. */
export function UpcomingSessions({ branch, sessions, title }: { branch: BranchSummary | null; sessions: PublicSession[]; title?: string }) {
  if (!branch) return null;
  return (
    <Section className="pt-0">
      <Container className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading kicker="Coming up" title={title ?? `Classes at ${branch.name}`} text="Times shown in the branch's local time." />
          <Button asChild variant="outline"><Link href={timetableHref(branch.slug)}><CalendarDays className="size-4" /> Full timetable</Link></Button>
        </div>
        {sessions.length > 0 ? (
          <ul className="grid gap-3 md:grid-cols-3">
            {sessions.map((session, i) => (
              <li key={session.id}>
                <Link
                  href={sessionHref(session.id)}
                  className={cn(
                    "notch group flex h-full flex-col p-6 transition-transform hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-forest",
                    i === 0 ? "bg-accent text-accent-foreground" : "bg-ink text-on-ink",
                  )}
                  aria-label={`View ${session.class_type.name} on ${formatSiteDate(session.starts_at, session.timezone)} at ${formatSiteTime(session.starts_at, session.timezone)}`}
                >
                  <p className={cn("text-xs font-semibold tracking-wider uppercase", i === 0 ? "text-forest" : "text-accent")}>{formatSiteDate(session.starts_at, session.timezone)}</p>
                  <p className="mt-6 font-display text-6xl font-extrabold leading-none tabular-nums">{formatSiteTime(session.starts_at, session.timezone)}</p>
                  <h3 className="mt-4 font-display text-xl font-extrabold uppercase">{session.class_type.name}</h3>
                  <p className={cn("mt-1 text-sm", i === 0 ? "text-forest/80" : "text-on-ink-muted")}>{session.duration_min} min{session.coach_name ? ` · Coach ${session.coach_name}` : ""}</p>
                  <p className="mt-auto flex items-center justify-between pt-6 text-xs font-bold tracking-wider uppercase">
                    {session.seats_left > 0 ? `${session.seats_left} seats left` : session.waitlist_open ? "Waitlist open" : "Full"}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border border-border px-5 py-4 text-sm text-body">No upcoming classes are published for this branch yet. Open the timetable to check another week or branch.</p>
        )}
      </Container>
    </Section>
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
            <figure key={`${story.name}-${index}`} className="overflow-hidden border border-border bg-card">
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

/** The shop tile fills whatever the event and story cards leave of the row. */
const SHOP_SPAN: Record<number, string> = { 0: "md:col-span-3", 1: "md:col-span-2" };

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
            <Link key={event.id} href={`/events/${event.slug}`} className="group block overflow-hidden border border-border bg-card transition-colors hover:border-forest/40">
              {event.cover_image_url ? <Picture src={event.cover_image_url} alt="" className="aspect-[16/10] w-full" /> : null}
              <div className="p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-forest dark:text-accent">Upcoming event · {formatSiteDate(event.starts_at)}</p>
                <h3 className="mt-2 font-display text-xl font-extrabold uppercase">{event.title}</h3>
                {event.location_text ? <p className="mt-2 flex items-center gap-1 text-sm text-body"><MapPin className="size-4" />{event.location_text}</p> : null}
                <p className="mt-4 text-sm font-semibold text-forest dark:text-accent">View event <ArrowRight className="inline size-4" /></p>
              </div>
            </Link>
          ))}
          {articles.map((article) => (
            <Link key={article.id} href={`/news/${article.slug}`} className="group block overflow-hidden border border-border bg-card transition-colors hover:border-forest/40">
              {article.cover_image_url ? <Picture src={article.cover_image_url} alt="" className="aspect-[16/10] w-full" /> : null}
              <div className="p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-forest dark:text-accent">From the journal</p>
                <h3 className="mt-2 font-display text-xl font-extrabold uppercase">{article.title}</h3>
                {article.excerpt ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-body">{article.excerpt}</p> : null}
                <p className="mt-4 text-sm font-semibold text-forest dark:text-accent">Read story <ArrowRight className="inline size-4" /></p>
              </div>
            </Link>
          ))}
          <Link href="/apparel" className={cn("notch group relative isolate flex min-h-64 flex-col justify-between overflow-hidden bg-ink p-6 text-on-ink md:p-8", SHOP_SPAN[events.length + articles.length])}>
            <div aria-hidden className="absolute inset-y-0 right-0 -z-10 w-2/3 bg-[url(/brand/pattern.png)] bg-cover opacity-50 [mask-image:linear-gradient(to_left,black,transparent)]" />
            <ShoppingBag className="size-7 text-accent" />
            <div className="mt-12">
              <p className="text-xs font-semibold tracking-wider text-accent uppercase">NüHabit Shop</p>
              <h3 className="mt-2 max-w-xl font-display text-3xl font-extrabold leading-none uppercase md:text-4xl">Gear for training days and everything after.</h3>
              <p className="mt-6 inline-flex items-center gap-3 text-sm font-bold tracking-wider uppercase">Explore the shop <ArrowSquare /></p>
            </div>
          </Link>
        </div>
      </Container>
    </Section>
  );
}
