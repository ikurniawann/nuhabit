"use client";

/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUp,
  BriefcaseBusiness,
  ChevronDown,
  Clock3,
  MapPin,
} from "lucide-react";

const logoUrl = "/brand/wordmark-black.png";

const studioImages = [
  "https://lh3.googleusercontent.com/aida-public/AB6AXuDJr8IKAu_mCH2MXuI0aBsNIWp2CsmUx2bPP--qivo51UWxxyAdNGCKrk_1XY7XHmZ_wAZLFWYTKuFjdHi0-4zAZanbIiUxWbpBU-ZkJedhWA7FCcObdBkJaLGL3PHefi86Y984mxF1mw843hAo6Ip1R4ia5c_LN2Pv1hLYMDdwBC9rQEjdxterd171OS-FTEK2sYSDoW1aagus7Gp-WoN9KGhI5NmQt8HqbJmn9xoVU5Om859B60lbw67wnqYWuS7LhAnmXiLIeGc",
  "https://lh3.googleusercontent.com/aida-public/AB6AXuB-QbuLlImiqXu15EoPcx4w3iKZkKC-2E67oGPDGX4zjVMb8-0kFSuNAiOy4uEorrWyRSDJ2MsUc8U9dMywq3_UGDgy6YU3zoRxRCNcxZrRHIWKDgg-d2cM_FJV7MrpJm6K_up6b4hREXMWt1w_73zaub3XUMPVOCD4UfN1rXcb52zPrcdGU4gFdOR1GLufis_GC9Tx3zarzTU6x1toa0NLiLmB-hM5qz8zxffbQ491hUKCLOydanez-5fkrD0S2cD3znhPKpv1AN8",
  "https://lh3.googleusercontent.com/aida-public/AB6AXuDtAxc1rnIOAcMycwzDJ2jEEGuvbAE8ZPq74bOgyELlKvw7WuCbiSmXR3l2l3S4Ylf48ohds6dYc6SrLy21jIuX1fFYe10TJG2ferRBZwbcQ8O_GFcykkLBjYCxcKK0rdFLRvNKLjLH5gOpcv11EMPTul-JXocjEiFAXPy2lyZscWfuS2t9xGIqcWSLv3Aylj5gMOuhg-2XY2hRBCVRFXr5-g9PINz0kS1j-_69ISAUOyI1U23JOGIAsAIoD7NOhdqlBlHJFhhlbbw",
];

interface JobOpening {
  id: string;
  position_id: string | null;
  brand_id: string | null;
  department_id: string | null;
  title: string;
  slug: string;
  department: string;
  location: string;
  employment_type: string;
  work_mode: string;
  headcount: number;
  description: string | null;
  requirements: string | null;
  benefits: string | null;
  closing_date: string | null;
  department_ref?: { id: string; name: string; code: string } | null;
}

async function fetchPublicJobs(): Promise<JobOpening[]> {
  const res = await fetch("/api/job-openings/public");
  const json: { data?: unknown } = await res.json();
  return Array.isArray(json.data) ? (json.data as JobOpening[]) : [];
}

export default function CareerPage() {
  const [showNotice, setShowNotice] = useState(true);
  // A failed load shows an empty list ("No open positions"), as before.
  const { data: jobs, isPending: jobsLoading } = useQuery({ queryKey: ["career-jobs"], queryFn: fetchPublicJobs });

  const departments = useMemo(() => {
    const groups = new Map<string, JobOpening[]>();
    (jobs ?? []).forEach((job) => {
      const key = job.department_ref?.name || job.department || "Operations";
      groups.set(key, [...(groups.get(key) || []), job]);
    });
    return Array.from(groups.entries()).map(([name, roles]) => ({ name, roles }));
  }, [jobs]);

  return (
    <div id="top" lang="en" className="min-h-screen bg-beige text-[#131a1c] career-roundo">
      <nav className="fixed top-0 z-50 w-full border-b border-[#e3dbcc] bg-beige/95 backdrop-blur">
        <div className="mx-auto flex h-20 max-w-[1280px] items-center justify-between px-4 sm:px-6 lg:px-10">
          <Link href="/career" className="flex h-full items-center" aria-label="NüHabit careers">
            <img src={logoUrl} alt="NüHabit" className="h-7 w-auto sm:h-8" />
          </Link>
          <a
            href="#open-roles"
            className="rounded-full bg-[#00281a] px-6 py-2 text-sm font-semibold uppercase tracking-[0.08em] text-white transition hover:bg-[#203b32] active:scale-95"
          >
            Open Roles
          </a>
        </div>
      </nav>

      <main className="overflow-x-hidden pb-20 pt-36 sm:pt-40">
        <section className="mx-auto mb-20 max-w-[1280px] px-4 text-center sm:px-6 lg:px-10">
          <h1 className="mb-6 text-4xl font-semibold leading-tight tracking-normal sm:text-5xl lg:text-6xl">
            Join our team
          </h1>
          <div className="mx-auto max-w-3xl space-y-6 text-lg leading-relaxed text-[#2a332e]">
            <p>
              NüHabit is growing a team that builds warm, imaginative, and precise experiences across hospitality,
              media, design, and technology.
            </p>
            <p>
              If you are passionate about making thoughtful work at 150% and discovering new possibilities, we would love to
              meet you.
            </p>
          </div>
        </section>

        <section className="mb-20 w-full overflow-hidden">
          <div className="mx-auto mb-6 max-w-[1280px] px-4 sm:px-6 lg:px-10">
            <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-[#2a332e]">Our Studio Space</h2>
          </div>
          <div className="relative flex w-full overflow-hidden">
            <div className="career-marquee flex whitespace-nowrap">
              {[...studioImages, ...studioImages].map((src, index) => (
                <div key={`${src}-${index}`} className="group relative mx-2 aspect-[3/4] w-[58vw] shrink-0 cursor-crosshair sm:w-[35vw] md:w-[25vw]">
                  <img src={src} alt={`Studio ${index + 1}`} className="h-full w-full object-cover grayscale" />
                  <div className="absolute inset-0 bg-[#00281a] opacity-60 mix-blend-multiply transition-opacity duration-700 group-hover:opacity-20" />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="open-roles" className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-10">
          <div className="space-y-3">
            {jobsLoading && (
              <div className="border-y border-[#e3dbcc] py-10 text-center text-[#2a332e]">
                Loading open roles...
              </div>
            )}

            {!jobsLoading && departments.length === 0 && (
              <div className="border-y border-[#e3dbcc] py-10 text-center text-[#2a332e]">
                No open positions at this time. Check back later.
              </div>
            )}

            {!jobsLoading && departments.map((department) => (
              <details key={department.name} className="group border-b border-[#e3dbcc] open:pb-6" open={department.roles.length > 0}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-6">
                  <h2 className="text-2xl font-medium leading-tight tracking-normal">{department.name}</h2>
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-bold uppercase tracking-[0.18em] text-[#2a332e]">
                      {department.roles.length} Positions
                    </span>
                    <ChevronDown className="h-5 w-5 transition-transform duration-300 group-open:rotate-180" />
                  </div>
                </summary>

                {department.roles.length === 0 ? (
                  <div className="py-6 text-center italic text-[#2a332e]">No open positions at this time. Check back later.</div>
                ) : (
                  <div className="space-y-2 px-1">
                    {department.roles.map((job) => (
                      <Link
                        key={job.id}
                        href={`/portal?job_opening_id=${job.id}&position_id=${job.position_id || ""}&brand_id=${job.brand_id || ""}`}
                        className="group/item flex flex-col justify-between gap-4 rounded-lg border border-[#e3dbcc] bg-mint p-6 transition-all duration-300 hover:border-[#203b32] md:flex-row md:items-center"
                      >
                        <div>
                          <h3 className="text-2xl font-medium leading-tight transition-colors group-hover/item:text-[#203b32]">
                            {job.title}
                          </h3>
                          <div className="mt-3 flex flex-wrap items-center gap-6 text-sm font-medium text-[#2a332e]">
                            <span className="flex items-center gap-1.5">
                              <MapPin className="h-4 w-4" />
                              {job.location}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <Clock3 className="h-4 w-4" />
                              {job.employment_type}
                            </span>
                          </div>
                          {job.description && (
                            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#2a332e]">
                              {job.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="rounded-full border border-[#e3dbcc] px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] transition-colors hover:bg-[#f3ece2]">
                            View Details
                          </span>
                          <span className="hidden rounded-full border border-[#e3dbcc] px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] md:inline-block">
                            {job.work_mode}
                          </span>
                          <ArrowRight className="h-5 w-5 -translate-x-2 text-[#203b32] opacity-0 transition-all duration-300 group-hover/item:translate-x-0 group-hover/item:opacity-100" />
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </details>
            ))}
          </div>
        </section>

        <section className="mx-auto mt-20 max-w-[1280px] px-4 sm:px-6 lg:px-10">
          <div className="flex flex-col items-center justify-between gap-10 rounded-lg border border-[#e3dbcc] bg-[#f3ece2] p-8 text-center md:flex-row md:p-16 md:text-left">
            <div className="max-w-xl">
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-mint text-[#203b32]">
                <BriefcaseBusiness className="h-5 w-5" />
              </div>
              <h2 className="mb-3 text-3xl font-semibold leading-tight">Don&apos;t see a role for you?</h2>
              <p className="text-base leading-relaxed text-[#2a332e]">
                We are always on the lookout for exceptional talent. Send us your profile and let&apos;s start a conversation
                about future possibilities.
              </p>
            </div>
            <Link
              href="/portal"
              className="whitespace-nowrap rounded-full border border-[#131a1c] px-10 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-[#131a1c] transition-colors hover:bg-[#131a1c] hover:text-white"
            >
              General Application
            </Link>
          </div>
        </section>
      </main>

      <footer className="w-full border-t border-[#e3dbcc] bg-beige py-20">
        <div className="mx-auto grid max-w-[1280px] grid-cols-1 gap-10 px-4 sm:px-6 md:grid-cols-2 lg:px-10">
          <div className="space-y-6">
            <div className="flex h-12 items-center">
              <img src={logoUrl} alt="NüHabit" className="h-7 w-auto sm:h-8" />
            </div>
            <p className="max-w-sm text-base leading-relaxed text-[#2a332e]">
              Designing emotional experiences at the intersection of technology, art, and service.
            </p>
            <p className="text-base text-[#2a332e]">© 2026 NüHabit. All rights reserved.</p>
          </div>
          <div className="flex flex-col justify-between gap-10 md:items-end">
            <div className="flex flex-wrap gap-6">
              {["LinkedIn", "Instagram", "Vimeo", "Privacy Policy", "Terms"].map((item) => (
                <a key={item} href="#" className="text-base text-[#2a332e] transition-colors hover:text-[#203b32]">
                  {item}
                </a>
              ))}
            </div>
            <a href="#top" className="group flex items-center gap-1 text-[#2a332e]">
              <span className="text-sm font-semibold uppercase tracking-[0.12em] transition-colors group-hover:text-[#203b32]">
                Back to top
              </span>
              <ArrowUp className="h-4 w-4 text-[#203b32]" />
            </a>
          </div>
        </div>
      </footer>

      {showNotice && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm px-2 sm:bottom-6 sm:right-6">
          <div className="rounded-lg border border-[#2e3132] bg-[#131a1c] p-6 text-white shadow-2xl">
            <p className="mb-5 text-xs font-semibold leading-relaxed opacity-80">
              All current job openings are posted first on our official website. Please avoid filling out forms on
              third-party platforms, downloading apps, or sharing personal information outside official channels.
            </p>
            <button
              type="button"
              onClick={() => setShowNotice(false)}
              className="w-full rounded-full border border-[#e3dbcc] py-3 text-sm font-semibold uppercase tracking-[0.12em] transition-colors hover:bg-[#e3dbcc] hover:text-[#131a1c]"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
