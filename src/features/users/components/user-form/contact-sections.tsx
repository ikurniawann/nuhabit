import { BanknotesIcon, PhoneIcon } from "@heroicons/react/24/outline";
import { FormSectionCard } from "@/components/layout/form-section-card";
import type { UserEmployeeFormValues } from "@/lib/hris/users-form";
import { TextField } from "./text-field";

interface SectionProps {
  form: UserEmployeeFormValues;
  onChange: (patch: Partial<UserEmployeeFormValues>) => void;
}

/** Bank & BPJS dan kontak darurat, berdampingan di layar lebar. */
export function ContactSections({ form, onChange }: SectionProps) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <FormSectionCard icon={BanknotesIcon} title="Bank & BPJS" bodyClassName="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="Bank"
            value={form.bank_name}
            onChange={(bank_name) => onChange({ bank_name })}
          />
          <TextField
            label="Account Number"
            value={form.bank_account}
            onChange={(bank_account) => onChange({ bank_account })}
          />
        </div>
      </FormSectionCard>

      <FormSectionCard icon={PhoneIcon} title="Emergency Contact" bodyClassName="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="Name"
            value={form.emergency_contact_name}
            onChange={(emergency_contact_name) => onChange({ emergency_contact_name })}
          />
          <TextField
            label="Phone"
            value={form.emergency_contact_phone}
            onChange={(emergency_contact_phone) => onChange({ emergency_contact_phone })}
          />
        </div>
      </FormSectionCard>
    </div>
  );
}
