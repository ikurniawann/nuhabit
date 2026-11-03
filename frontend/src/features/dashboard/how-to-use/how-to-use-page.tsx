import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import type { GuideTopic } from "./topics";

export function HowToUsePage({ topics }: { topics: GuideTopic[] }) {
  return (
    <div className="space-y-5">
      <PageHeader title="How to use" description="Panduan singkat untuk menu yang bisa Anda buka." />
      <div className="grid gap-4 lg:grid-cols-2">
        {topics.map((topic) => (
          <section key={topic.title} className="rounded-2xl bg-card p-5 shadow-card">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-base font-semibold text-foreground">{topic.title}</h2>
              {topic.href ? (
                <Link href={topic.href} className="shrink-0 text-sm font-medium text-foreground underline">
                  Buka halaman
                </Link>
              ) : null}
            </div>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-6 text-muted-foreground">
              {topic.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
