"use client";

import { useWatch, type UseFormReturn } from "react-hook-form";
import { formatNumber } from "@/lib/format";
import type { ApplicationFormValues } from "./application-schema";
import { controlClass, FormField, FormSection } from "./form-field";

const AVAILABILITY: [NonNullable<ApplicationFormValues["availability"]>, string][] = [
  ["immediate", "Immediately"],
  ["1_week", "1 week"],
  ["2_weeks", "2 weeks"],
  ["1_month", "1 month"],
];

/** Salary input display: "Rp 5.000.000" from raw digits. */
const salaryDisplay = (digits: string | undefined) => (digits ? `Rp ${formatNumber(parseInt(digits, 10))}` : "");

/** Experience, education, availability and expected salary. */
export function ProfileSection({ form }: { form: UseFormReturn<ApplicationFormValues> }) {
  const { register, setValue, control, formState } = form;
  const { errors } = formState;
  const [availability, salary] = useWatch({ control, name: ["availability", "expected_salary"] });

  return (
    <FormSection title="Additional Information">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="last_experience" label="Most Recent Work Experience" error={errors.last_experience?.message}>
          <input
            id="last_experience"
            placeholder="Company - Position (2 years)"
            {...register("last_experience")}
            className={controlClass()}
          />
        </FormField>

        <FormField id="last_education" label="Highest Education" error={errors.last_education?.message}>
          <input
            id="last_education"
            placeholder="Degree - Major - School"
            {...register("last_education")}
            className={controlClass()}
          />
        </FormField>

        <FormField id="availability" label="Available to Start">
          <select
            id="availability"
            value={availability || ""}
            onChange={(e) =>
              setValue("availability", (e.target.value || undefined) as ApplicationFormValues["availability"])
            }
            className={controlClass()}
          >
            <option value="">Choose availability</option>
            {AVAILABILITY.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </FormField>

        <FormField id="expected_salary" label="Expected Salary (Rp)">
          <input
            id="expected_salary"
            type="text"
            inputMode="numeric"
            value={salaryDisplay(salary)}
            onChange={(e) => setValue("expected_salary", e.target.value.replace(/\D/g, ""))}
            placeholder="Rp 0"
            className={controlClass()}
          />
        </FormField>
      </div>
    </FormSection>
  );
}
