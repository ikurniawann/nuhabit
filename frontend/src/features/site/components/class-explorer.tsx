"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TrainingContent } from "../types";
import { PanelButton } from "./panel-button";
import { Crosshair, FALLBACK_PHOTOS, Picture, timetableHref } from "./site-section";

/** Class types as a list on the left and the chosen one as a photo panel on the right. */
export function ClassExplorer({ classes, branchSlug }: { classes: TrainingContent["class_types"]; branchSlug?: string }) {
  const [active, setActive] = useState(0);
  const current = classes[active];
  if (!current) return null;

  return (
    <div className="relative grid border border-border lg:grid-cols-[18rem_minmax(0,1fr)]">
      <Crosshair className="-top-[5px] -left-[5px]" />
      <Crosshair className="-right-[5px] -bottom-[5px]" />
      <div role="tablist" aria-label="Class types" aria-orientation="vertical" className="no-scrollbar flex overflow-x-auto border-b border-border lg:flex-col lg:border-r lg:border-b-0">
        {classes.map((item, i) => (
          <button
            key={item.name}
            type="button"
            role="tab"
            id={`class-tab-${i}`}
            aria-selected={i === active}
            aria-controls="class-panel"
            onClick={() => setActive(i)}
            className={cn(
              "flex shrink-0 items-center justify-between gap-4 border-r border-border px-5 py-4 text-left text-sm font-bold tracking-wide uppercase transition-colors lg:border-r-0 lg:border-b",
              i === active ? "bg-ink text-on-ink" : "text-body hover:bg-surface-2",
            )}
          >
            {item.name}
            <span className={cn("text-xs font-semibold normal-case", i === active ? "text-accent" : "text-muted-foreground")}>{item.duration}</span>
          </button>
        ))}
      </div>
      <div id="class-panel" role="tabpanel" aria-labelledby={`class-tab-${active}`} className="p-3">
        <div className="relative isolate flex min-h-[26rem] flex-col justify-end overflow-hidden bg-ink p-6 text-on-ink md:min-h-[30rem] md:p-8">
          <Picture key={current.name} src={FALLBACK_PHOTOS.classes[active % FALLBACK_PHOTOS.classes.length]} alt="" className="absolute inset-0 -z-10 h-full w-full object-[50%_20%] grayscale" />
          <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-ink via-ink/60 to-transparent" />
          <span className="mb-4 self-start bg-accent px-2.5 py-1 text-xs font-bold tracking-wider text-accent-foreground uppercase">{current.duration}</span>
          <h3 className="font-display text-4xl font-extrabold leading-none tracking-tight uppercase md:text-6xl">{current.name}</h3>
          <p className="mt-3 max-w-xl text-sm leading-6 text-on-ink-muted md:text-base">{current.text}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild className="uppercase"><Link href={timetableHref(branchSlug)}>
              <CalendarDays /> See class times
            </Link></Button>
            <PanelButton panel="trial" branchSlug={branchSlug} variant="onInk" className="uppercase">
              Book a trial
            </PanelButton>
          </div>
        </div>
      </div>
    </div>
  );
}
