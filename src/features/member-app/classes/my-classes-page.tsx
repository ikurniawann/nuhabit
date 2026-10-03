"use client";

import { ArrowLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { activePackages, joinDot } from "../lib/classes-view";
import { useT } from "../lib/i18n";
import { classImage } from "../lib/images";
import { m } from "../lib/links";
import { useClassTypes, useSessions, useWallet } from "../lib/queries-classes";
import { Spinner, formatDay, formatDayTime } from "../ui";

/** Class types the member is entitled to through their active packages. */
export function MyClassesPage() {
  const t = useT();
  const router = useRouter();
  const { data: wallet, isLoading: walletLoading } = useWallet();
  const { data: classTypes, isLoading: typesLoading } = useClassTypes();
  const { data: sessions } = useSessions();

  if (walletLoading || typesLoading || !wallet || !classTypes) return <Spinner label={t("Loading your classes…")} />;

  const activePkgs = activePackages(wallet);
  const coversAll = activePkgs.some((p) => p.coverageIds === null);
  const coveredIds = new Set(activePkgs.flatMap((p) => p.coverageIds ?? []));
  const entitled = classTypes.filter((c) => coversAll || coveredIds.has(c.id));

  const packagesFor = (classTypeId: string) =>
    activePkgs.filter((p) => p.coverageIds === null || p.coverageIds.includes(classTypeId));

  const nextSessionFor = (classTypeId: string) =>
    (sessions ?? [])
      .filter(
        (v) =>
          v.session.classTypeId === classTypeId &&
          ["PUBLISHED", "FULL"].includes(v.session.status) &&
          new Date(v.session.startsAt).getTime() > Date.now()
      )
      .sort((a, b) => new Date(a.session.startsAt).getTime() - new Date(b.session.startsAt).getTime())[0];

  return (
    <div className="flex flex-col gap-5">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-bold text-nh-muted">
        <ArrowLeft size={16} /> {t("Back")}
      </button>
      <div>
        <h1 className="nh-display text-3xl">{t("My classes")}</h1>
        <p className="mt-1 text-sm text-nh-muted">{t("Everything your purchased packages let you book.")}</p>
      </div>

      {activePkgs.length === 0 ? (
        <div className="nh-card nh-surface-ink relative overflow-hidden !border-0 !p-6 text-white">
          <div className="pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full bg-nh-lime/20 blur-3xl" />
          <div className="relative">
            <p className="nh-display text-2xl leading-tight">{t("No active package yet.")}</p>
            <p className="mt-1.5 text-sm text-white/60">
              {t("Top up with a credit package and your covered classes appear here.")}
            </p>
            <Link href={m("/wallet/topup")} className="nh-btn-brand mt-4 block text-center">
              {t("Browse packages")}
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Where the entitlement comes from */}
          <div className="-mx-5 flex snap-x gap-2.5 overflow-x-auto px-5 pb-1">
            {activePkgs.map((p) => (
              <div key={p.lotId} className="nh-surface-ink min-w-56 shrink-0 snap-start rounded-2xl p-4 text-white">
                <p className="truncate text-sm font-extrabold">{t(p.name)}</p>
                <p className="mt-0.5 text-xs text-white/55">
                  {p.coverageNames ? `${p.coverageNames.length} ${t("classes")}` : t("All classes")} · {t("until")}{" "}
                  {formatDay(p.expiresAt)}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            {entitled.map((c) => {
              const image = classImage(c.name);
              const next = nextSessionFor(c.id);
              const sources = packagesFor(c.id);
              return (
                <div key={c.id} className="nh-card overflow-hidden !p-0">
                  {image ? (
                    <div className="relative h-28 w-full">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image} alt="" className="h-full w-full object-cover" loading="lazy" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-black/5" />
                      <p className="nh-display absolute bottom-2.5 left-4 text-2xl text-white">{c.name}</p>
                    </div>
                  ) : null}
                  <div className="p-4">
                    {!image ? <p className="nh-display text-xl">{c.name}</p> : null}
                    <p className="text-sm text-nh-muted">{c.description}</p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      <span className="nh-chip bg-nh-raised text-nh-muted">
                        {c.default_duration_min} min · {c.default_credit_cost} cr
                      </span>
                      {sources.slice(0, 2).map((p) => (
                        <span key={p.lotId} className="nh-chip bg-nh-forest/10 text-nh-forest">
                          {t(p.name)}
                        </span>
                      ))}
                    </div>
                    {next ? (
                      <Link
                        href={m(`/classes/${next.session.id}`)}
                        className="mt-3 flex items-center justify-between rounded-xl bg-nh-raised px-3.5 py-2.5 text-sm"
                      >
                        <span className="min-w-0">
                          <span className="block font-extrabold">{t("Next session")}</span>
                          <span className="block truncate text-xs text-nh-muted">
                            {joinDot(formatDayTime(next.session.startsAt), next.branchName)}
                          </span>
                        </span>
                        <ChevronRight size={16} className="shrink-0 text-nh-muted" />
                      </Link>
                    ) : (
                      <p className="mt-3 text-xs font-bold text-nh-muted">{t("No upcoming sessions scheduled.")}</p>
                    )}
                  </div>
                </div>
              );
            })}
            {entitled.length === 0 ? (
              <p className="nh-card text-sm text-nh-muted">{t("Your packages don't cover any active class types.")}</p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
