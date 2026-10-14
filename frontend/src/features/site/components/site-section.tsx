import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full px-4 lg:px-6", className)}>{children}</div>;
}

export function Section({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  return <section id={id} className={cn("py-12 md:py-16", className)}>{children}</section>;
}

export function Kicker({ children, onInk = false }: { children: ReactNode; onInk?: boolean }) {
  return (
    <p className={cn("text-xs font-semibold tracking-wider uppercase", onInk ? "text-accent" : "text-forest dark:text-accent")}>
      {children}
    </p>
  );
}

export function SectionHeading({
  kicker,
  title,
  text,
  as: Tag = "h2",
  onInk = false,
}: {
  kicker?: string;
  title: string;
  text?: string;
  as?: "h1" | "h2";
  onInk?: boolean;
}) {
  return (
    <div className="max-w-2xl space-y-3">
      {kicker ? <Kicker onInk={onInk}>{kicker}</Kicker> : null}
      <Tag className={cn("font-display text-3xl font-extrabold leading-[0.95] tracking-tight uppercase text-balance md:text-5xl", Tag === "h1" && "md:text-6xl")}>
        {title}
      </Tag>
      {text ? <p className={cn("text-base md:text-lg", onInk ? "text-on-ink-muted" : "text-body")}>{text}</p> : null}
    </div>
  );
}

/** A card with a hairline border, matching the site's editorial grid. */
export function Tile({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("border border-border bg-card p-6", className)}>{children}</div>;
}

/** An image or a neutral placeholder when the URL is empty. */
export function Picture({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
  if (!src) {
    return <div aria-hidden className={cn("bg-surface-2", className)} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" className={cn("object-cover", className)} />;
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="border border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">{children}</p>;
}

/** A small "+" marking a grid intersection. Forest on light, lime on ink. */
export function Crosshair({ className, onInk = false }: { className?: string; onInk?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 10 10" className={cn("pointer-events-none absolute size-2.5", onInk ? "text-accent" : "text-forest", className)}>
      <path d="M5 0v10M0 5h10" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** The lime square with an arrow that ends display links. */
export function ArrowSquare({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex size-8 shrink-0 items-center justify-center bg-accent text-accent-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5", className)}>
      <ArrowUpRight className="size-5" />
    </span>
  );
}

/** Stock photos shipped with the member app, used until the editor sets real ones. */
export const FALLBACK_PHOTOS = {
  hero: "/member-assets/img/hero-login.jpg",
  method: "/member-assets/img/class-mob.jpg",
  community: "/member-assets/img/class-test.jpg",
  classes: ["/member-assets/img/class-str.jpg", "/member-assets/img/class-eng.jpg", "/member-assets/img/class-wod.jpg", "/member-assets/img/class-fund.jpg"],
} as const;

/** Sub-page header: a hairline grid with the title on the left and an optional photo on the right. */
export function PageHero({ kicker, title, text, image, children }: {
  kicker: string;
  title: string;
  text?: string;
  image?: string;
  children?: ReactNode;
}) {
  return (
    <Section className="pb-8 md:pb-10">
      <Container>
        <div className={cn("relative grid border border-border", image && "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]")}>
          <Crosshair className="-top-[5px] -left-[5px]" />
          <Crosshair className="-right-[5px] -bottom-[5px]" />
          <div className="flex flex-col justify-end gap-5 p-6 md:p-10 lg:p-12">
            <Kicker>{kicker}</Kicker>
            <h1 className="font-display text-4xl font-extrabold leading-[0.92] tracking-tight text-balance uppercase sm:text-5xl lg:text-7xl">{title}</h1>
            {text ? <p className="max-w-2xl text-base text-body md:text-lg">{text}</p> : null}
            {children ? <div className="flex flex-wrap gap-3 pt-1">{children}</div> : null}
          </div>
          {image ? (
            <div className="border-t border-border p-3 lg:border-t-0 lg:border-l">
              <Picture src={image} alt="" className="notch aspect-[16/10] h-full w-full grayscale sm:aspect-[21/9] lg:aspect-auto lg:min-h-[22rem]" />
            </div>
          ) : null}
        </div>
      </Container>
    </Section>
  );
}

/** The timetable page, opened on a branch when one is known. */
export function timetableHref(branchSlug?: string): string {
  return branchSlug ? `/training/timetable?branch=${encodeURIComponent(branchSlug)}` : "/training/timetable";
}
