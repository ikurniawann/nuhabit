import { CalendarDays, MapPin } from "lucide-react";
import { PublicFormBody, type PublicFormView } from "@/features/crm/public-form";
import { formatSiteDate, formatSiteDateTime, formatSiteTime } from "../lib/dates";
import { Markdown } from "../lib/markdown";
import type { SiteEvent } from "../types";
import { Container, Picture, Section } from "./site-section";

function when(event: SiteEvent): string {
  const start = formatSiteDateTime(event.starts_at);
  if (!event.ends_at) return start;
  const sameDay = event.starts_at.slice(0, 10) === event.ends_at.slice(0, 10);
  return sameDay ? `${start} to ${formatSiteTime(event.ends_at)}` : `${formatSiteDate(event.starts_at)} to ${formatSiteDate(event.ends_at)}`;
}

export function EventPage({ event, form }: { event: SiteEvent; form: PublicFormView | null }) {
  return (
    <article>
      <Section className="pb-6">
        <Container className="max-w-3xl space-y-4">
          <p className="text-xs font-semibold tracking-wider text-forest uppercase dark:text-accent">Event</p>
          <h1 className="font-display text-3xl font-bold tracking-tight text-balance md:text-5xl">{event.title}</h1>
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-body">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-muted-foreground" />
              <dt className="sr-only">When</dt>
              <dd>{when(event)}</dd>
            </div>
            {event.location_text ? (
              <div className="flex items-center gap-2">
                <MapPin className="size-4 text-muted-foreground" />
                <dt className="sr-only">Where</dt>
                <dd>{event.location_text}</dd>
              </div>
            ) : null}
          </dl>
        </Container>
      </Section>
      {event.cover_image_url ? (
        <Container className="max-w-4xl">
          <Picture src={event.cover_image_url} alt="" className="aspect-[16/9] w-full rounded-card" />
        </Container>
      ) : null}
      <Section className="pt-8">
        <Container className="max-w-3xl space-y-10">
          <Markdown source={event.body_md} className="prose-site" />
          {form ? (
            <div id="register" className="rounded-card bg-card p-6 shadow-card sm:p-8">
              <h2 className="text-2xl font-bold text-foreground">{form.title}</h2>
              {form.description ? <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{form.description}</p> : null}
              <div className="mt-6">
                <PublicFormBody form={form} startedAt={form.rendered_at} />
              </div>
            </div>
          ) : null}
        </Container>
      </Section>
    </article>
  );
}
