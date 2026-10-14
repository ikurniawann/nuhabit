"use client";

import dynamic from "next/dynamic";
import { Container, Section } from "./site-section";

// The panel reads the branch cookie on its first render, so it renders in the browser only.
const TimetablePanel = dynamic(() => import("../panels/timetable-panel"), { ssr: false });

/** The timetable panel, laid out as a page section. */
export function TimetableSection({ branchSlug }: { branchSlug?: string }) {
  return (
    <Section className="pt-0">
      <Container className="max-w-4xl">
        <div className="border border-border p-4 md:p-8">
          <TimetablePanel branchSlug={branchSlug} onClose={() => {}} />
        </div>
      </Container>
    </Section>
  );
}
