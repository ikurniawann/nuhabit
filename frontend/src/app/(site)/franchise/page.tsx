import type { Metadata } from "next";
import { LeadFormPage } from "@/features/site/components/lead-form-page";
import { Tile } from "@/features/site/components/site-section";

export const metadata: Metadata = { title: "Own a Gym" };

const STEPS = [
  { title: "Application", text: "Fill in this form. The branch development team reads every application within two business days." },
  { title: "Introduction", text: "A 30-minute video call about your city, the locations you have in mind and the partnership model." },
  { title: "Site study", text: "We review the space, access and surrounding market with you before any commitment." },
  { title: "Opening", text: "Equipment, program, coach training and launch follow the NüHabit standard." },
];

export default function Page() {
  return (
    <LeadFormPage
      kicker="Partnership"
      title="Own a Gym"
      intro="Bring the NüHabit method to your city: the 8-week program, small classes and the operating system already running at our branches. Tell us your plan and our team will get in touch."
      slug="franchise"
      aside={
        <Tile className="space-y-4">
          <h2 className="font-display text-lg font-semibold">What happens after you send</h2>
          <ol className="space-y-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="font-display text-lg font-bold text-forest tabular-nums dark:text-accent">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="font-semibold text-foreground">{step.title}</p>
                  <p className="text-sm text-body">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </Tile>
      }
    />
  );
}
