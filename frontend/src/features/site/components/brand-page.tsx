import { Markdown } from "../lib/markdown";
import type { BrandContent } from "../types";
import { Container, Picture, Section, SectionHeading, Tile } from "./site-section";

export function BrandPage({ brand }: { brand: BrandContent }) {
  return (
    <>
      <Section className="pb-6">
        <Container>
          <SectionHeading as="h1" kicker="Our Story" title={brand.title} text={brand.intro} />
        </Container>
      </Section>
      <Section className="pt-4">
        <Container className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:gap-12">
          <Markdown source={brand.story_md} className="prose-site" />
          {brand.image_url ? <Picture src={brand.image_url} alt="" className="aspect-[4/5] w-full rounded-card" /> : null}
        </Container>
      </Section>
      {brand.values.length > 0 ? (
        <Section className="pt-0">
          <Container className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {brand.values.map((v, i) => (
              <Tile key={`${v.title}-${i}`} className="space-y-2">
                <h2 className="font-display text-xl font-semibold">{v.title}</h2>
                <p className="text-sm text-body">{v.text}</p>
              </Tile>
            ))}
          </Container>
        </Section>
      ) : null}
    </>
  );
}
