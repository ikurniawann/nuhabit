/* eslint-disable @next/next/no-img-element -- wordmark statis, sama dgn halaman karir */
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Briefcase } from "lucide-react";
import { ApplicationForm, type ApplicationPrefill } from "./application-form";
import { SuccessDialog } from "./success-dialog";

const logoUrl = "/brand/wordmark-black.png";

/** Halaman lamaran publik (/portal): header karir, form, footer, modal sukses. */
export function ApplicationPage(prefill: ApplicationPrefill) {
  const router = useRouter();
  const [submitted, setSubmitted] = useState(false);

  const closeSuccess = () => {
    setSubmitted(false);
    router.push("/career");
  };

  return (
    <div id="top" className="min-h-screen bg-[#f8f4ee] text-[#131a1c] career-roundo">
      <nav className="fixed top-0 z-50 w-full border-b border-[#e3dbcc] bg-[#f8f4ee]/95 backdrop-blur">
        <div className="mx-auto flex h-20 max-w-[1280px] items-center justify-between px-4 sm:px-6 lg:px-10">
          <Link href="/career" className="flex h-full items-center" aria-label="NüHabit careers">
            <img src={logoUrl} alt="NüHabit" className="h-7 w-auto sm:h-8" />
          </Link>
          <Link
            href="/career"
            className="rounded-full bg-[#00281a] px-6 py-2 text-sm font-semibold uppercase tracking-[0.08em] text-white transition hover:bg-[#203b32] active:scale-95"
          >
            Back to Careers
          </Link>
        </div>
      </nav>

      <main className="overflow-x-hidden pb-20 pt-36 sm:pt-40">
        <section className="mx-auto mb-10 max-w-[700px] px-4 text-center sm:px-6 lg:px-10">
          <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#f3ece2] text-[#00281a]">
            <Briefcase className="h-5 w-5" />
          </div>
          <h1 className="mb-3 text-2xl font-semibold leading-tight sm:text-3xl">Submit Your Application</h1>
          <p className="mx-auto max-w-xl text-base leading-relaxed text-[#2a332e]">
            Isi formulir di bawah untuk melamar posisi yang tersedia.
          </p>
        </section>

        <section className="mx-auto max-w-[700px] px-4 sm:px-6 lg:px-10">
          <ApplicationForm prefill={prefill} onSubmitted={() => setSubmitted(true)} />
          <p className="mt-6 text-center text-xs text-[#2a332e]">
            Dengan mengirim lamaran, kamu menyetujui kebijakan privasi NüHabit
          </p>
        </section>
      </main>

      <footer className="w-full border-t border-[#e3dbcc] bg-[#f8f4ee] py-12">
        <div className="mx-auto grid max-w-[1280px] grid-cols-1 gap-8 px-4 sm:px-6 md:grid-cols-2 lg:px-10">
          <div className="space-y-4">
            <div className="flex h-10 items-center">
              <img src={logoUrl} alt="NüHabit" className="h-7 w-auto sm:h-8" />
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-[#2a332e]">
              Designing emotional experiences at the intersection of technology, art, and service.
            </p>
            <p className="text-sm text-[#2a332e]">© 2026 NüHabit. All rights reserved.</p>
          </div>
          <div className="flex flex-col justify-between gap-6 md:items-end">
            <div className="flex flex-wrap gap-4">
              {["LinkedIn", "Instagram", "Vimeo", "Privacy Policy", "Terms"].map((item) => (
                <a key={item} href="#" className="text-sm text-[#2a332e] transition-colors hover:text-[#00281a]">
                  {item}
                </a>
              ))}
            </div>
            <Link href="#top" className="group flex items-center gap-1 text-[#2a332e]">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] transition-colors group-hover:text-[#00281a]">
                Back to top
              </span>
              <ArrowUp className="h-3 w-3 text-[#00281a]" />
            </Link>
          </div>
        </div>
      </footer>

      {submitted && <SuccessDialog onClose={closeSuccess} />}
    </div>
  );
}
