import Link from "next/link";
import { Button } from "@/components/ui/button";
import { classHref, coachHref } from "../lib/training";
import type { ClassTypeContent, CoachContent } from "../types";
import { PanelButton } from "./panel-button";
import { ArrowSquare, Container, FALLBACK_PHOTOS, Picture, Section } from "./site-section";

// Building blocks shared by the training pages.

export const classPhoto = (item: ClassTypeContent, index: number) =>
  item.image_url || FALLBACK_PHOTOS.classes[index % FALLBACK_PHOTOS.classes.length];

/** Lime band closing a training page: start a trial or sign in. */
export function JoinBand({ title = "Ready for your first class?" }: { title?: string }) {
  return (
    <Section>
      <Container>
        <div className="notch flex flex-col gap-6 bg-accent p-6 text-accent-foreground md:flex-row md:items-end md:justify-between md:p-12">
          <h2 className="max-w-2xl font-display text-3xl font-extrabold leading-[0.95] tracking-tight uppercase md:text-5xl">{title}</h2>
          <div className="flex flex-wrap gap-3">
            <PanelButton panel="trial" variant="ink" size="lg" className="uppercase">Start a trial</PanelButton>
            <Button asChild variant="outline" size="lg" className="border-forest/30 bg-transparent uppercase hover:bg-forest/5">
              <Link href="/member/auth/login">Member login</Link>
            </Button>
          </div>
        </div>
      </Container>
    </Section>
  );
}

export function ClassCard({ item, index }: { item: ClassTypeContent; index: number }) {
  return (
    <Link href={classHref(item)} className="group flex h-full flex-col border border-border bg-card transition-colors hover:border-forest/40">
      <div className="relative p-3 pb-0">
        <Picture src={classPhoto(item, index)} alt="" className="notch aspect-[4/3] w-full object-[50%_25%] grayscale transition duration-500 group-hover:grayscale-0" />
        {item.duration ? <span className="absolute bottom-3 left-3 bg-accent px-2.5 py-1 text-xs font-bold tracking-wider text-accent-foreground uppercase">{item.duration}</span> : null}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-6">
        {item.level ? <p className="text-xs font-semibold tracking-wider text-forest uppercase dark:text-accent">{item.level}</p> : null}
        <h3 className="font-display text-2xl font-extrabold uppercase">{item.name}</h3>
        <p className="text-sm leading-6 text-body">{item.text}</p>
        <p className="mt-auto flex items-center justify-between pt-4 text-xs font-bold tracking-wider uppercase">
          About this class <ArrowSquare />
        </p>
      </div>
    </Link>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

/** The coach's photo, or their initials on ink when there is none. */
export function CoachPhoto({ coach, className }: { coach: CoachContent; className?: string }) {
  if (coach.image_url) return <Picture src={coach.image_url} alt={coach.name} className={`notch w-full object-[50%_25%] grayscale ${className ?? ""}`} />;
  return <div aria-hidden className={`notch flex w-full items-end bg-ink p-5 font-display text-6xl font-extrabold text-accent ${className ?? ""}`}>{initials(coach.name)}</div>;
}

export function CoachGrid({ coaches }: { coaches: CoachContent[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {coaches.map((coach) => (
        <li key={coach.name}>
          <Link href={coachHref(coach)} className="group flex h-full flex-col border border-border bg-card transition-colors hover:border-forest/40">
            <div className="p-3 pb-0">
              <CoachPhoto coach={coach} className="aspect-[4/5] transition duration-500 group-hover:grayscale-0" />
            </div>
            <div className="flex flex-1 flex-col gap-2 p-5">
              <h3 className="font-display text-xl font-extrabold uppercase">{coach.name}</h3>
              {coach.role ? <p className="text-xs font-semibold tracking-wider text-forest uppercase dark:text-accent">{coach.role}</p> : null}
              {coach.bio ? <p className="line-clamp-3 text-sm leading-6 text-body">{coach.bio}</p> : null}
              <p className="mt-auto flex items-center justify-between pt-4 text-xs font-bold tracking-wider uppercase">
                Profile and schedule <ArrowSquare />
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
