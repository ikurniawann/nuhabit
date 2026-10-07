import type { ReactNode } from "react";
import { PublicCrmForm } from "@/features/site-forms";
import { Container, Section, SectionHeading, Tile } from "./site-section";

/**
 * A fixed route around a seeded CRM form: a heading, an intro and the form
 * in a card, with an optional aside (contact details, what to expect).
 */
export function LeadFormPage({
  kicker,
  title,
  intro,
  slug,
  aside,
}: {
  kicker: string;
  title: string;
  intro: string;
  slug: string;
  aside?: ReactNode;
}) {
  return (
    <Section>
      <Container className="space-y-10">
        <SectionHeading as="h1" kicker={kicker} title={title} text={intro} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Tile className="sm:p-8">
            <PublicCrmForm slug={slug} />
          </Tile>
          {aside ? <div className="space-y-4">{aside}</div> : null}
        </div>
      </Container>
    </Section>
  );
}
