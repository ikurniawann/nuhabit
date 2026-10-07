import { CalendarDays, MapPin } from "lucide-react";
import { PublicFormPage, type PublicFormView } from "@/features/crm/public-form";
import { formatDate, formatDateTime } from "@/lib/format";
import { Markdown } from "../lib/markdown";
import type { SiteEvent } from "../types";
import { Container, Picture, Section } from "./site-section";

function when(event: SiteEvent): string {
  const start = formatDateTime(event.starts_at);
  if (!event.ends_at) return start;
  const sameDay = event.starts_at.slice(0, 10) === event.ends_at.slice(0, 10);
  return sameDay ? `${start} sampai ${formatDateTime(event.ends_at).split(" ").pop()}` : `${formatDate(event.starts_at)} sampai ${formatDate(event.ends_at)}`;
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
              <dt className="sr-only">Waktu</dt>
              <dd>{when(event)}</dd>
            </div>
            {event.location_text ? (
              <div className="flex items-center gap-2">
                <MapPin className="size-4 text-muted-foreground" />
                <dt className="sr-only">Lokasi</dt>
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
            <div id="daftar" className="rounded-card bg-card p-2 shadow-card">
              <PublicFormPage form={form} embedded />
            </div>
          ) : null}
        </Container>
      </Section>
    </article>
  );
}
