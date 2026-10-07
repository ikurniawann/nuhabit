import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EventPage } from "@/features/site/components/event-page";
import { fetchEvent } from "@/features/site/lib/public-api";
import { loadPublicForm, publicFormView } from "@/lib/crm/public-forms-server";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = await fetchEvent((await params).slug);
  return { title: event?.title ?? "Event" };
}

export default async function Page({ params }: Props) {
  const event = await fetchEvent((await params).slug);
  if (!event) notFound();
  const form = event.form_slug ? await loadPublicForm(event.form_slug) : null;
  return <EventPage event={event} form={form ? publicFormView(form) : null} />;
}
