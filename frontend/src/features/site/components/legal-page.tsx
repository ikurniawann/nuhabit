import { Markdown } from "../lib/markdown";
import type { LegalContent } from "../types";
import { Container, Section, SectionHeading } from "./site-section";

export function LegalPage({ content }: { content: LegalContent }) {
  return (
    <Section>
      <Container className="max-w-3xl space-y-8">
        <SectionHeading as="h1" title={content.title} />
        <Markdown source={content.body_md} className="prose-site" />
      </Container>
    </Section>
  );
}
