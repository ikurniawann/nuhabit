"use client";

import { Mail, MapPin, Phone } from "lucide-react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import type { ApplicationFormValues } from "./application-schema";
import { controlClass, FormField, FormSection } from "./form-field";
import type { PortalOptions } from "./use-portal-options";

interface PersonalInfoSectionProps {
  form: UseFormReturn<ApplicationFormValues>;
  options: PortalOptions | undefined;
  optionsLoading: boolean;
  brandLocked: boolean;
}

const SOURCES: [ApplicationFormValues["source"], string][] = [
  ["portal", "Website"],
  ["instagram", "Instagram"],
  ["jobstreet", "JobStreet"],
  ["referral", "Referral"],
  ["walk_in", "Walk-in"],
  ["other", "Other"],
];

const ICON = "absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#2a332e]";

/** Outlet, position, identity, contact, residence and how the applicant heard of us. */
export function PersonalInfoSection({ form, options, optionsLoading, brandLocked }: PersonalInfoSectionProps) {
  const { register, setValue, control, formState } = form;
  const { errors } = formState;
  const [brandId, positionId, source] = useWatch({ control, name: ["brand_id", "position_id", "source"] });
  const positions = options?.positions ?? [];

  return (
    <FormSection title="Personal Information">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="brand_id" label="Outlet / Brand">
          <select
            id="brand_id"
            value={brandId || ""}
            onChange={(e) => setValue("brand_id", e.target.value || undefined)}
            disabled={brandLocked}
            className={controlClass()}
          >
            <option value="">{brandLocked ? "Auto-selected" : "Choose an outlet (optional)"}</option>
            {(options?.outlets ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField id="position_id" label="Position">
          <select
            id="position_id"
            value={positionId || ""}
            onChange={(e) => setValue("position_id", e.target.value || undefined)}
            className={controlClass()}
          >
            <option value="">
              {optionsLoading ? "Loading positions..." : positions.length > 0 ? "Choose a position" : "No positions available"}
            </option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          {optionsLoading && <p className="text-xs text-[#2a332e]">Loading positions...</p>}
          {!optionsLoading && positions.length === 0 && (
            <p className="text-xs text-[#00281a]">No open positions right now</p>
          )}
        </FormField>

        <FormField id="full_name" label="Full Name" required error={errors.full_name?.message}>
          <input
            id="full_name"
            placeholder="Full name"
            {...register("full_name")}
            className={controlClass(Boolean(errors.full_name))}
          />
        </FormField>

        <FormField id="email" label="Email" required error={errors.email?.message}>
          <div className="relative">
            <Mail className={ICON} />
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              {...register("email")}
              className={controlClass(Boolean(errors.email), true)}
            />
          </div>
        </FormField>

        <FormField id="phone" label="WhatsApp Number" required error={errors.phone?.message}>
          <div className="relative">
            <Phone className={ICON} />
            <input
              id="phone"
              type="tel"
              placeholder="081234567890"
              {...register("phone")}
              className={controlClass(Boolean(errors.phone), true)}
            />
          </div>
        </FormField>

        <FormField id="domicile" label="City of Residence" required error={errors.domicile?.message}>
          <div className="relative">
            <MapPin className={ICON} />
            <input
              id="domicile"
              placeholder="Jakarta Selatan"
              {...register("domicile")}
              className={controlClass(Boolean(errors.domicile), true)}
            />
          </div>
        </FormField>

        <FormField id="source" label="How Did You Hear About Us" required error={errors.source?.message}>
          <select
            id="source"
            value={source || "portal"}
            onChange={(e) => setValue("source", e.target.value as ApplicationFormValues["source"])}
            className={controlClass(Boolean(errors.source))}
          >
            {SOURCES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </FormField>
      </div>
    </FormSection>
  );
}
