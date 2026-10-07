"use client";

import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { portalRequest } from "@/lib/recruitment/portal-client";
import { applicationFormSchema, toSubmitFormData, type ApplicationFormValues } from "./application-schema";
import { DocumentSection } from "./document-section";
import { PersonalInfoSection } from "./personal-info-section";
import { ProfileSection } from "./profile-section";
import { useApplicationFiles } from "./use-application-files";
import { usePortalOptions } from "./use-portal-options";

export interface ApplicationPrefill {
  brandId: string | null;
  positionId: string | null;
  jobOpeningId: string | null;
}

/**
 * Public application form. Brand and position from the URL win; when the
 * applicant arrives from a job opening, the opening fills the blanks and
 * locks the outlet.
 */
export function ApplicationForm({ prefill, onSubmitted }: { prefill: ApplicationPrefill; onSubmitted: () => void }) {
  const { data: options, isPending: optionsLoading } = usePortalOptions(prefill.jobOpeningId);
  const files = useApplicationFiles();
  const opening = options?.opening;

  const form = useForm<ApplicationFormValues>({
    resolver: zodResolver(applicationFormSchema),
    defaultValues: { source: "portal" },
    // Auto-fill once the options arrive; fields the applicant already edited stay.
    values: {
      source: "portal",
      brand_id: prefill.brandId ?? opening?.brand_id ?? undefined,
      position_id: prefill.positionId ?? opening?.position_id ?? undefined,
    } as ApplicationFormValues,
    resetOptions: { keepDirtyValues: true },
  });

  const submit = useMutation({
    mutationFn: (values: ApplicationFormValues) =>
      portalRequest("/api/portal/submit", {
        method: "POST",
        body: toSubmitFormData(values, {
          jobOpeningId: prefill.jobOpeningId,
          cv: files.cvFile,
          photo: files.photoFile,
        }),
      }),
    onSuccess: onSubmitted,
    retry: false,
  });

  return (
    <form onSubmit={form.handleSubmit((values) => submit.mutate(values))} className="space-y-4">
      <PersonalInfoSection
        form={form}
        options={options}
        optionsLoading={optionsLoading}
        brandLocked={Boolean(prefill.jobOpeningId)}
      />
      <ProfileSection form={form} />
      <DocumentSection files={files} />

      <div className="rounded-lg border border-[#e3dbcc] bg-white p-5 sm:p-6">
        <h2 className="mb-4 text-base font-medium leading-tight">Notes (Optional)</h2>
        <textarea
          placeholder="Anything else you want us to know..."
          rows={3}
          {...form.register("notes")}
          className={`min-h-[100px] w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-[#00281a] disabled:cursor-not-allowed disabled:opacity-50 ${form.formState.errors.notes ? "border-[#00281a]" : "border-[#e3dbcc]"}`}
        />
        {form.formState.errors.notes && (
          <p className="mt-1 text-xs text-[#00281a]">{form.formState.errors.notes.message}</p>
        )}
      </div>

      {submit.error && (
        <div className="rounded-lg border border-[#00281a] bg-[#eeffb1] p-4 text-sm text-[#00281a]">
          {submit.error.message}
        </div>
      )}

      <button
        type="submit"
        disabled={submit.isPending || !files.cvFile || !files.photoFile}
        className="w-full rounded-full bg-[#00281a] px-8 py-3.5 text-sm font-semibold uppercase tracking-[0.08em] text-white transition-all hover:bg-[#203b32] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submit.isPending ? (
          <>
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Submitting...
          </>
        ) : (
          "Submit Application"
        )}
      </button>

      {!files.cvFile && (
        <p className="-mt-3 text-center text-xs text-[#2a332e]">* Upload your CV to submit the application</p>
      )}
    </form>
  );
}
