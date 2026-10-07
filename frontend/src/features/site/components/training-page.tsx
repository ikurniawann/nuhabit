import type { TrainingContent } from "../types";
import { PanelButton } from "./panel-button";
import { Container, Section, SectionHeading, Tile } from "./site-section";

export function TrainingPage({ training }: { training: TrainingContent }) {
  const { intro, class_types: classTypes, block, laws } = training;
  return (
    <>
      <Section className="pb-8">
        <Container className="space-y-6">
          <SectionHeading as="h1" kicker="Training" title={intro.title} text={intro.text} />
          <PanelButton panel="timetable" variant="ink">
            Lihat jadwal kelas
          </PanelButton>
        </Container>
      </Section>

      {classTypes.length > 0 ? (
        <Section className="pt-4">
          <Container>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {classTypes.map((c, i) => (
                <Tile key={`${c.name}-${i}`} className="space-y-2">
                  <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{c.duration}</p>
                  <h2 className="font-display text-xl font-semibold">{c.name}</h2>
                  <p className="text-sm text-body">{c.text}</p>
                </Tile>
              ))}
            </div>
          </Container>
        </Section>
      ) : null}

      {block.phases.length > 0 ? (
        <Section className="bg-ink text-on-ink">
          <Container className="space-y-8">
            <SectionHeading kicker="Program" title={block.title} text={block.text} onInk />
            <ol className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {block.phases.map((p, i) => (
                <li key={`${p.name}-${i}`} className="rounded-card bg-white/5 p-5">
                  <p className="text-xs font-semibold tracking-wider text-accent uppercase">{p.weeks}</p>
                  <h3 className="font-display mt-2 text-lg font-semibold">{p.name}</h3>
                  <p className="mt-2 text-sm text-on-ink-muted">{p.text}</p>
                </li>
              ))}
            </ol>
          </Container>
        </Section>
      ) : null}

      {laws.items.length > 0 ? (
        <Section>
          <Container className="space-y-6">
            <SectionHeading kicker="Aturan main" title={laws.title} />
            <ol className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {laws.items.map((item, i) => (
                <li key={i} className="flex gap-4 rounded-card bg-card p-5 shadow-card">
                  <span className="font-display text-2xl font-bold text-forest tabular-nums dark:text-accent">{String(i + 1).padStart(2, "0")}</span>
                  <p className="self-center text-body">{item}</p>
                </li>
              ))}
            </ol>
          </Container>
        </Section>
      ) : null}
    </>
  );
}
