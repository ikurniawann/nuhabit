"use client";

import { useWatch, type UseFormReturn } from "react-hook-form";
import { formatNumber } from "@/lib/format";
import type { ApplicationFormValues } from "./application-schema";
import { controlClass, FormField, FormSection } from "./form-field";

const AVAILABILITY: [NonNullable<ApplicationFormValues["availability"]>, string][] = [
  ["immediate", "Secepatnya"],
  ["1_week", "1 Minggu"],
  ["2_weeks", "2 Minggu"],
  ["1_month", "1 Bulan"],
];

/** Tampilan input gaji: "Rp 5.000.000" dari digit mentah. */
const salaryDisplay = (digits: string | undefined) => (digits ? `Rp ${formatNumber(parseInt(digits, 10))}` : "");

/** Pengalaman, pendidikan, ketersediaan, dan ekspektasi gaji. */
export function ProfileSection({ form }: { form: UseFormReturn<ApplicationFormValues> }) {
  const { register, setValue, control, formState } = form;
  const { errors } = formState;
  const [availability, salary] = useWatch({ control, name: ["availability", "expected_salary"] });

  return (
    <FormSection title="Informasi Tambahan">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="last_experience" label="Pengalaman Kerja Terakhir" error={errors.last_experience?.message}>
          <input
            id="last_experience"
            placeholder="PT Company - Position (2 tahun)"
            {...register("last_experience")}
            className={controlClass()}
          />
        </FormField>

        <FormField id="last_education" label="Pendidikan Terakhir" error={errors.last_education?.message}>
          <input
            id="last_education"
            placeholder="S1/D3/SMA - Jurusan - Universitas"
            {...register("last_education")}
            className={controlClass()}
          />
        </FormField>

        <FormField id="availability" label="Ketersediaan Bergabung">
          <select
            id="availability"
            value={availability || ""}
            onChange={(e) =>
              setValue("availability", (e.target.value || undefined) as ApplicationFormValues["availability"])
            }
            className={controlClass()}
          >
            <option value="">Pilih ketersediaan</option>
            {AVAILABILITY.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </FormField>

        <FormField id="expected_salary" label="Ekspektasi Gaji (Rp)">
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
