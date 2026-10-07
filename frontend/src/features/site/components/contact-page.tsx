import Link from "next/link";
import { Camera, Mail, MapPin, MessageCircle, Music2, Play } from "lucide-react";
import type { BranchSummary, SocialContent } from "../types";
import { LeadFormPage } from "./lead-form-page";
import { Tile } from "./site-section";

function waHref(number: string): string {
  return `https://wa.me/${number.replace(/\D/g, "")}`;
}

/** The contact page: the CRM form with the HQ's channels and branch addresses beside it. */
export function ContactPage({ social, branches }: { social: SocialContent; branches: BranchSummary[] }) {
  const hq = branches[0];
  const links = [
    { href: social.instagram, label: "Instagram", Icon: Camera },
    { href: social.tiktok, label: "TikTok", Icon: Music2 },
    { href: social.youtube, label: "YouTube", Icon: Play },
  ].filter((item) => item.href);

  return (
    <LeadFormPage
      kicker="Contact"
      title="Get in touch"
      intro="Questions about classes, apparel orders or anything else. We reply by email during business hours; for anything urgent, WhatsApp is faster."
      slug="contact"
      aside={
        <>
          <Tile className="space-y-4">
            <h2 className="font-display text-lg font-semibold">Head office</h2>
            <dl className="space-y-3 text-sm">
              {hq ? (
                <div className="flex gap-3">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div>
                    <dt className="sr-only">Address</dt>
                    <dd className="text-body">
                      <span className="font-semibold text-foreground">{hq.name}</span>
                      <br />
                      {[hq.address, hq.city, hq.postcode].filter(Boolean).join(", ")}
                    </dd>
                  </div>
                </div>
              ) : null}
              {social.whatsapp || hq?.phone ? (
                <div className="flex gap-3">
                  <MessageCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div>
                    <dt className="sr-only">WhatsApp</dt>
                    <dd>
                      <a href={waHref(social.whatsapp || hq?.phone || "")} className="text-forest hover:underline dark:text-accent" target="_blank" rel="noopener noreferrer">
                        {social.whatsapp || hq?.phone}
                      </a>
                    </dd>
                  </div>
                </div>
              ) : null}
              {social.email ? (
                <div className="flex gap-3">
                  <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div>
                    <dt className="sr-only">Email</dt>
                    <dd>
                      <a href={`mailto:${social.email}`} className="text-forest hover:underline dark:text-accent">
                        {social.email}
                      </a>
                    </dd>
                  </div>
                </div>
              ) : null}
            </dl>
            {links.length > 0 ? (
              <ul className="flex flex-wrap gap-2 pt-1">
                {links.map(({ href, label, Icon }) => (
                  <li key={label}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5 text-sm text-foreground hover:bg-surface"
                    >
                      <Icon className="size-4" />
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </Tile>
          {branches.length > 1 ? (
            <Tile className="space-y-3">
              <h2 className="font-display text-lg font-semibold">Our gyms</h2>
              <ul className="space-y-2 text-sm">
                {branches.map((b) => (
                  <li key={b.slug}>
                    <Link href={`/locations/${b.slug}`} className="font-semibold text-foreground hover:underline">
                      {b.name}
                    </Link>
                    {b.city ? <span className="text-muted-foreground"> · {b.city}</span> : null}
                  </li>
                ))}
              </ul>
            </Tile>
          ) : null}
        </>
      }
    />
  );
}
