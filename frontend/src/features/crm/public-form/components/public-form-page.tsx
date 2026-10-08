"use client";

import Image from "next/image";
import { PublicFormBody, type PublicFormDefinition } from "./public-form-body";

export interface PublicFormView extends PublicFormDefinition {
  /** Stempel waktu render dari server — dasar pengukuran lama pengisian. */
  rendered_at: number;
}

const COPYRIGHT_YEAR = new Date().getFullYear();

/** EPIC-050 T-5.3 — halaman publik poskopi.reddie.id/public. */
export function PublicFormPage({ form }: { form: PublicFormView }) {
  return (
    <main className="relative min-h-screen bg-jungle">
      <div className="absolute inset-0">
        <Image src="/brand/wallpaper.webp" alt="" fill priority className="object-cover opacity-25" sizes="100vw" />
        <div className="absolute inset-0 bg-gradient-to-b from-jungle/80 via-forest/85 to-jungle/95" />
      </div>

      {/* min-h-dvh, bukan min-h-screen: globals.css punya aturan global
          `.flex.min-h-screen` yang menimpa latar dengan page-mesh terang. */}
      <div className="relative mx-auto flex min-h-dvh max-w-3xl flex-col px-5 py-10 sm:py-16">
        <div className="flex items-center gap-3">
          <Image src="/brand/wordmark-black.png" alt="NüHabit" width={1200} height={165} className="h-7 w-auto" priority />
        </div>

        <div className="relative mt-8 rounded-2xl bg-card p-6 shadow-2xl sm:p-8">
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{form.title}</h1>
          {form.description ? <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{form.description}</p> : null}
          <div className="mt-6">
            <PublicFormBody form={form} startedAt={form.rendered_at} />
          </div>
        </div>

        <p className="mt-auto pt-10 text-center text-xs text-white/50">
          © {COPYRIGHT_YEAR} NüHabit
        </p>
      </div>
    </main>
  );
}
