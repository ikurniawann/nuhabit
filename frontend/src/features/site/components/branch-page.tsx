import { AtSign, Mail, MapPin, Phone } from "lucide-react";
import type { BranchProfile } from "../types";
import { PanelButton } from "./panel-button";
import { Container, Kicker, Picture, Section, SectionHeading, Tile } from "./site-section";

const ACCORDION_LABELS: { key: keyof BranchProfile["accordions"]; label: string }[] = [
  { key: "facilities", label: "Fasilitas" },
  { key: "parking", label: "Parkir & akses" },
  { key: "team", label: "Tim coach" },
  { key: "community", label: "Komunitas" },
];

function instagramHref(handle: string): string {
  if (handle.startsWith("http")) return handle;
  return `https://instagram.com/${handle.replace(/^@/, "")}`;
}

function BranchActions({ slug }: { slug: string }) {
  return (
    <div className="flex flex-wrap gap-3">
      <PanelButton panel="trial" branchSlug={slug} size="lg">
        Coba Gratis
      </PanelButton>
      <PanelButton panel="membership" branchSlug={slug} size="lg" variant="onInk">
        Membership
      </PanelButton>
      <PanelButton panel="timetable" branchSlug={slug} size="lg" variant="onInk">
        Jadwal kelas
      </PanelButton>
    </div>
  );
}

export function BranchPage({ branch }: { branch: BranchProfile }) {
  const address = [branch.address, branch.city, branch.postcode].filter(Boolean).join(", ");
  const mapsHref =
    branch.lat !== null && branch.lng !== null
      ? `https://www.google.com/maps/search/?api=1&query=${branch.lat},${branch.lng}`
      : address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${branch.name} ${address}`)}`
        : null;

  return (
    <>
      <section className="relative isolate overflow-hidden bg-ink text-on-ink">
        {branch.hero_image_url ? (
          <Picture src={branch.hero_image_url} alt="" className="absolute inset-0 -z-10 h-full w-full opacity-45" />
        ) : (
          <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 -z-10 size-80 rounded-full bg-accent/25 blur-3xl" />
        )}
        <Container className="flex min-h-[52dvh] flex-col justify-end gap-6 py-14 md:py-20">
          <div className="space-y-3">
            <Kicker onInk>NüHabit {branch.city ?? ""}</Kicker>
            <h1 className="font-display text-4xl font-bold tracking-tight text-balance md:text-6xl">{branch.name}</h1>
            {address ? <p className="max-w-xl text-on-ink-muted">{address}</p> : null}
          </div>
          <BranchActions slug={branch.slug} />
        </Container>
      </section>

      {branch.benefits.length > 0 ? (
        <Section>
          <Container className="space-y-6">
            <SectionHeading kicker="Kenapa di sini" title="Yang kamu dapat di cabang ini" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {branch.benefits.map((b, i) => (
                <Tile key={`${b.title}-${i}`} className="space-y-2">
                  <h3 className="font-display text-lg font-semibold">{b.title}</h3>
                  <p className="text-sm text-body">{b.text}</p>
                </Tile>
              ))}
            </div>
          </Container>
        </Section>
      ) : null}

      <Section className="pt-0">
        <Container className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Tile className="space-y-4">
            <h2 className="font-display text-xl font-semibold">Info cabang</h2>
            <ul className="space-y-3 text-sm">
              {address ? (
                <li className="flex gap-3">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="text-body">
                    {address}
                    {mapsHref ? (
                      <>
                        {" "}
                        <a href={mapsHref} target="_blank" rel="noopener noreferrer" className="font-semibold text-forest hover:underline dark:text-accent">
                          Buka peta
                        </a>
                      </>
                    ) : null}
                  </span>
                </li>
              ) : null}
              {branch.phone ? (
                <li className="flex gap-3">
                  <Phone className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <a href={`tel:${branch.phone.replace(/\s+/g, "")}`} className="text-body hover:underline">
                    {branch.phone}
                  </a>
                </li>
              ) : null}
              {branch.email ? (
                <li className="flex gap-3">
                  <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <a href={`mailto:${branch.email}`} className="text-body hover:underline">
                    {branch.email}
                  </a>
                </li>
              ) : null}
              {branch.instagram ? (
                <li className="flex gap-3">
                  <AtSign className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <a href={instagramHref(branch.instagram)} target="_blank" rel="noopener noreferrer" className="text-body hover:underline">
                    {branch.instagram}
                  </a>
                </li>
              ) : null}
            </ul>
            {branch.directions ? (
              <div className="space-y-1 border-t border-border/60 pt-4 text-sm">
                <p className="font-semibold">Petunjuk arah</p>
                <p className="text-body whitespace-pre-line">{branch.directions}</p>
              </div>
            ) : null}
          </Tile>

          <div className="space-y-3">
            {ACCORDION_LABELS.map(({ key, label }) => {
              const lines = branch.accordions[key];
              if (!lines || lines.length === 0) return null;
              return (
                <details key={key} className="group rounded-card bg-card shadow-card">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 font-display text-lg font-semibold [&::-webkit-details-marker]:hidden">
                    {label}
                    <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <ul className="space-y-2 px-6 pb-5 text-sm text-body">
                    {lines.map((line, i) => (
                      <li key={i} className="flex gap-2">
                        <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-forest dark:bg-accent" />
                        {line}
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        </Container>
      </Section>

      {branch.extras.length > 0 ? (
        <Section className="pt-0">
          <Container className="space-y-6">
            <SectionHeading kicker="Tambahan" title="Layanan ekstra" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {branch.extras.map((x, i) => (
                <Tile key={`${x.name}-${i}`} className="space-y-1">
                  <h3 className="font-semibold">{x.name}</h3>
                  <p className="text-sm text-body">{x.blurb}</p>
                </Tile>
              ))}
            </div>
          </Container>
        </Section>
      ) : null}

      {branch.testimonials.length > 0 ? (
        <Section className="bg-surface">
          <Container className="space-y-6">
            <SectionHeading kicker="Kata member" title="Mereka yang sudah latihan di sini" />
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {branch.testimonials.map((t, i) => (
                <li key={`${t.name}-${i}`}>
                  <figure className="h-full rounded-card bg-card p-6 shadow-card">
                    <blockquote className="text-body">“{t.quote}”</blockquote>
                    <figcaption className="mt-4 text-sm">
                      <span className="font-semibold">{t.name}</span>
                      {t.role ? <span className="text-muted-foreground"> · {t.role}</span> : null}
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          </Container>
        </Section>
      ) : null}
    </>
  );
}
