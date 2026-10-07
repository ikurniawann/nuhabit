import type { Metadata } from "next";
import { LeadFormPage } from "@/features/site/components/lead-form-page";
import { Tile } from "@/features/site/components/site-section";

export const metadata: Metadata = { title: "Equipment" };

const ITEMS = ["Sled push and sled pull", "SkiErg and rowing", "Wall balls, sandbags and farmer's carry", "Rigs, barbells and training flooring"];

export default function Page() {
  return (
    <LeadFormPage
      kicker="Equipment"
      title="HYROX-standard equipment for your gym"
      intro="The equipment we use at every branch, from a single station to a complete package. Tell us what you need and how much space you have; our team replies during business hours with a recommendation and pricing."
      slug="equipment"
      aside={
        <Tile className="space-y-3">
          <h2 className="font-display text-lg font-semibold">What we can help with</h2>
          <ul className="space-y-2 text-sm text-body">
            {ITEMS.map((item) => (
              <li key={item} className="flex gap-3">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-forest dark:bg-accent" />
                {item}
              </li>
            ))}
          </ul>
        </Tile>
      }
    />
  );
}
