import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 lg:px-6", className)}>{children}</div>;
}

export function Section({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("py-12 md:py-16", className)}>{children}</section>;
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
      <Tag className={cn("font-display text-3xl font-bold tracking-tight md:text-4xl", Tag === "h1" && "md:text-5xl")}>
        {title}
      </Tag>
      {text ? <p className={cn("text-base md:text-lg", onInk ? "text-on-ink-muted" : "text-body")}>{text}</p> : null}
    </div>
  );
}

/** A soft card with rounded corners and no border. */
export function Tile({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-card bg-card p-6 shadow-card", className)}>{children}</div>;
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
  return <p className="rounded-card bg-card px-6 py-10 text-center text-sm text-muted-foreground shadow-card">{children}</p>;
}
