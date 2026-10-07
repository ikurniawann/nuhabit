"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "../lib/i18n";
import { initialsOf } from "../lib/initials";
import { m } from "../lib/links";
import { useBranches, useTrainers } from "../lib/queries-classes";
import { Spinner } from "../ui";

/**
 * Browsing by who is teaching.
 *
 * People pick a class by the coach as often as by the hour, and the schedule
 * could only be read by time. Coaches with nothing on stay on the list: a
 * member looking for somebody by name should find them and be told they have
 * nothing coming up, rather than be left wondering whether they have left.
 */
export function TrainersPage() {
  const t = useT();
  const [branchId, setBranchId] = useState("");
  const { data: branches } = useBranches();
  const { data: trainers, isLoading } = useTrainers(branchId || undefined);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="nh-display text-3xl font-black">{t("Trainers")}</h1>
        <p className="mt-1 text-sm text-nh-muted">{t("Who is teaching over the next fortnight.")}</p>
      </div>

      {/* Branch filter: only worth showing when there is more than one branch. */}
      {(branches ?? []).length > 1 ? (
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          <button
            onClick={() => setBranchId("")}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-bold transition ${
              branchId === "" ? "bg-nh-forest/10 text-nh-forest ring-1 ring-nh-forest/20" : "bg-nh-cream text-nh-muted"
            }`}
          >
            {t("All branches")}
          </button>
          {(branches ?? []).map((b) => (
            <button
              key={b.id}
              onClick={() => setBranchId(b.id)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-bold transition ${
                branchId === b.id ? "bg-nh-forest/10 text-nh-forest ring-1 ring-nh-forest/20" : "bg-nh-cream text-nh-muted"
              }`}
            >
              {b.name}
            </button>
          ))}
        </div>
      ) : null}

      {isLoading ? (
        <Spinner label={t("Loading trainers…")} />
      ) : (trainers ?? []).length === 0 ? (
        <div className="nh-card text-sm text-nh-muted">{t("No trainers at this branch yet.")}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {(trainers ?? []).map((tr) => (
            <Link key={tr.coach.id} href={m(`/trainers/${tr.coach.id}`)} className="nh-card flex gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-nh-forest text-sm font-black text-nh-lime">
                {initialsOf(tr.coach.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-black">{tr.coach.name}</span>
                <span className="block truncate text-sm text-nh-muted">{tr.coach.specialization || tr.branchName}</span>
                {tr.classTypeNames.length > 0 ? (
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {tr.classTypeNames.slice(0, 2).map((name) => (
                      <span
                        key={name}
                        className="rounded-full bg-nh-forest/10 px-2 py-0.5 text-[11px] font-bold text-nh-forest"
                      >
                        {name}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-right">
                {tr.upcomingCount > 0 ? (
                  <>
                    <span className="nh-display block text-lg leading-tight font-black">{tr.upcomingCount}</span>
                    <span className="block text-[11px] text-nh-muted">
                      {t(tr.upcomingCount === 1 ? "class" : "classes")}
                    </span>
                  </>
                ) : (
                  <span className="text-[11px] text-nh-muted">{t("Nothing on")}</span>
                )}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
