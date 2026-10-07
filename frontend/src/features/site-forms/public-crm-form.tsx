"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { PublicFormBody, type PublicFormDefinition } from "@/features/crm/public-form";

async function fetchPublicForm(slug: string): Promise<PublicFormDefinition> {
  const res = await fetch(`/api/public/crm/forms/${slug}`, { cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: PublicFormDefinition; error?: string };
  if (!res.ok || !json.success || !json.data) throw new Error(json.error || "Form tidak ditemukan");
  return json.data;
}

/**
 * Form CRM publik yang dirender di dalam halaman situs (tanpa bingkai):
 * ambil definisi lewat slug, lalu tampilkan field dan tombol kirimnya.
 */
export function PublicCrmForm({ slug, onSubmitted }: { slug: string; onSubmitted?: () => void }) {
  const [startedAt] = useState(() => Date.now());
  const query = useQuery({ queryKey: ["public-crm-form", slug], queryFn: () => fetchPublicForm(slug) });

  if (query.isLoading) {
    return (
      <div className="py-10 text-center" aria-busy="true">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-forest" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <p className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
        {query.error instanceof Error ? query.error.message : "Form tidak dapat dimuat."}
      </p>
    );
  }
  return <PublicFormBody form={query.data} startedAt={startedAt} onSubmitted={onSubmitted} />;
}
