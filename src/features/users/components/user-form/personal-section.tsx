import { UserCircleIcon } from "@heroicons/react/24/outline";
import { FormFieldLabel, formComboboxClassName } from "@/components/layout/form-field";
import { FormSectionCard } from "@/components/layout/form-section-card";
import { Combobox } from "@/components/ui/combobox";
import type { UserEmployeeFormValues } from "@/lib/hris/users-form";
import { GENDER_OPTIONS } from "../../constants";
import { TextField } from "./text-field";

interface SectionProps {
  form: UserEmployeeFormValues;
  onChange: (patch: Partial<UserEmployeeFormValues>) => void;
}

export function PersonalSection({ form, onChange }: SectionProps) {
  return (
    <FormSectionCard
      icon={UserCircleIcon}
      title="Personal Information"
      description="Basic identity and contact details."
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          className="sm:col-span-2"
          label="Full Name"
          required
          value={form.full_name}
          onChange={(full_name) => onChange({ full_name })}
        />
        <TextField
          className="sm:col-span-2"
          label="Email"
          type="email"
          required
          value={form.email}
          onChange={(email) => onChange({ email })}
        />
        <TextField label="Phone" value={form.phone} onChange={(phone) => onChange({ phone })} />
        <TextField label="NIK / KTP" value={form.ktp} onChange={(ktp) => onChange({ ktp })} />
        <TextField
          label="Date of Birth"
          type="date"
          value={form.birth_date}
          onChange={(birth_date) => onChange({ birth_date })}
        />
        <div>
          <FormFieldLabel>Gender</FormFieldLabel>
          <Combobox
            options={GENDER_OPTIONS}
            value={form.gender}
            onChange={(gender) => onChange({ gender })}
            placeholder="Select"
            searchPlaceholder="Search..."
            emptyMessage="Not found"
            allowClear
            className={formComboboxClassName}
          />
        </div>
        <TextField
          className="sm:col-span-2 lg:col-span-4"
          label="Address"
          value={form.address}
          onChange={(address) => onChange({ address })}
        />
      </div>
    </FormSectionCard>
  );
}
