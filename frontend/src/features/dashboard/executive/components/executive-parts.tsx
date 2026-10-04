import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatRupiahCompact } from "@/lib/format";
import { changePercent, targetPercent } from "@/lib/dashboard/executive-view";

/** Change against a baseline; `onInk` renders it for the ink hero. */
export function Delta({
  now,
  before,
  label,
  onInk = false,
}: {
  now: number;
  before: number;
  label: string;
  onInk?: boolean;
}) {
  if (before <= 0) {
    return (
      <span
        className={cn(
          "text-xs",
          onInk ? "text-on-ink-muted" : "text-muted-foreground",
        )}
      >
        {label}: belum ada pembanding
      </span>
    );
  }
  const pct = changePercent(now, before);
  const up = pct >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
        onInk
          ? "bg-white/10 text-white"
          : up
            ? "bg-success-soft text-success"
            : "bg-danger-soft text-danger",
      )}
    >
      {up ? "▲" : "▼"} {Math.abs(pct)}%{" "}
      <span
        className={cn(
          "font-normal",
          onInk ? "text-on-ink-muted" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </span>
  );
}

export function OpenLink({
  href,
  label = "Buka",
}: {
  href: string;
  label?: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold text-foreground transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:outline-none"
    >
      {label}
      <ArrowUpRight className="size-3.5" />
    </Link>
  );
}

export function SectionCard({
  title,
  href,
  hrefLabel,
  children,
  failed,
}: {
  title: string;
  href?: string;
  hrefLabel?: string;
  children: React.ReactNode;
  failed?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        {href && (
          <CardAction>
            <OpenLink href={href} label={hrefLabel} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>{failed ? <FailedNote /> : children}</CardContent>
    </Card>
  );
}

export function FailedNote() {
  return (
    <p className="rounded-2xl bg-danger-soft px-3 py-2 text-xs text-danger">
      Data tidak terjangkau. Halaman memuat ulang otomatis tiap 60 detik.
    </p>
  );
}

export function TargetBar({
  value,
  target,
  label,
  onInk = false,
}: {
  value: number;
  target: number;
  label: string;
  onInk?: boolean;
}) {
  const pct = targetPercent(value, target);
  return (
    <div>
      <div
        className={cn(
          "mb-1.5 flex justify-between text-[11px]",
          onInk ? "text-on-ink-muted" : "text-muted-foreground",
        )}
      >
        <span>
          {label} {formatRupiahCompact(target)}
        </span>
        <span
          className={cn(
            "font-semibold tabular-nums",
            onInk ? "text-white" : "text-foreground",
          )}
        >
          {pct}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, pct)}
        aria-valuetext={`${pct}% dari ${label.toLowerCase()}`}
        className={cn(
          "h-1.5 overflow-hidden rounded-full",
          onInk ? "bg-white/15" : "bg-surface",
        )}
      >
        <i
          style={{ width: `${Math.min(100, pct)}%` }}
          className={cn(
            "block h-full rounded-full",
            onInk ? "bg-accent" : "bg-forest",
          )}
        />
      </div>
    </div>
  );
}
