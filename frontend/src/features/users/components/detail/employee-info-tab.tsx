import type { ComponentType } from "react";
import {
  BanknotesIcon,
  BuildingOfficeIcon,
  MapPinIcon,
  PhoneIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { calculateTenure } from "@/lib/hris/employee-profile-summary";
import type { Employee } from "@/types/hris";
import { GENDER_OPTIONS, MARITAL_OPTIONS, STATUS_LABELS } from "../../constants";

interface InfoRow {
  label: string;
  value: string;
}

function InfoCard({
  icon: Icon,
  title,
  rows,
  valueClassName = "",
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  rows: InfoRow[];
  valueClassName?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Icon className="w-4 h-4" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex justify-between text-sm">
            <span className="text-gray-500 shrink-0 w-36">{label}</span>
            <span className={`text-gray-900 text-right ${valueClassName}`}>{value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const optionLabel = (options: { value: string; label: string }[], value: string | null) =>
  options.find((o) => o.value === value)?.label ?? "-";

/** Tab "Personal Info": data diri, kontak, kepegawaian, bank & BPJS, kontak darurat. */
export function EmployeeInfoTab({ employee }: { employee: Employee }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <InfoCard
        icon={UserCircleIcon}
        title="Personal Data"
        rows={[
          { label: "Full Name", value: employee.full_name },
          {
            label: "Gender",
            value: optionLabel(GENDER_OPTIONS, employee.gender),
          },
          { label: "Date of Birth", value: formatDate(employee.birth_date) },
          {
            label: "Marital Status",
            value: optionLabel(MARITAL_OPTIONS, employee.marital_status),
          },
          { label: "KTP", value: employee.ktp || "-" },
          { label: "NPWP", value: employee.npwp || "-" },
        ]}
      />
      <InfoCard
        icon={MapPinIcon}
        title="Contact & Address"
        rows={[
          { label: "Email", value: employee.email },
          { label: "Phone", value: employee.phone || "-" },
          { label: "Address", value: employee.address || "-" },
          { label: "City", value: employee.city || "-" },
          { label: "Province", value: employee.province || "-" },
          { label: "Postal Code", value: employee.postal_code || "-" },
        ]}
      />
      <InfoCard
        icon={BuildingOfficeIcon}
        title="Employment Info"
        rows={[
          { label: "NIP", value: employee.nip },
          { label: "Department", value: employee.department?.name || "-" },
          { label: "Section", value: employee.section?.name || "-" },
          { label: "Job Title", value: employee.job_title?.title || "-" },
          { label: "Manager", value: employee.manager?.full_name || "-" },
          { label: "Join Date", value: formatDate(employee.join_date) },
          {
            label: "Status",
            value: STATUS_LABELS[employee.employment_status] || employee.employment_status,
          },
          { label: "Tenure", value: calculateTenure(employee.join_date) },
        ]}
      />
      <InfoCard
        icon={BanknotesIcon}
        title="Bank & BPJS"
        valueClassName="font-mono text-xs"
        rows={[
          { label: "Bank Name", value: employee.bank_name || "-" },
          { label: "Account No.", value: employee.bank_account || "-" },
          { label: "BPJS Employment", value: employee.bpjs_tk || "-" },
          { label: "BPJS Health", value: employee.bpjs_kesehatan || "-" },
        ]}
      />
      {(employee.emergency_contact_name || employee.emergency_contact_phone) && (
        <InfoCard
          icon={PhoneIcon}
          title="Emergency Contact"
          rows={[
            { label: "Name", value: employee.emergency_contact_name || "-" },
            { label: "Phone", value: employee.emergency_contact_phone || "-" },
            {
              label: "Relationship",
              value: employee.emergency_contact_relationship || "-",
            },
          ]}
        />
      )}
    </div>
  );
}
