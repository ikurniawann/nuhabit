"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRupiahInput, type SalaryAmountField } from "@/lib/hris/salary-form";

const INCOME_FIELDS: { field: SalaryAmountField; label: string }[] = [
  { field: "base_salary", label: "Gaji Pokok (Rp)" },
  { field: "fixed_allowance", label: "Tunjangan Tetap (Rp)" },
  { field: "variable_allowance", label: "Tunjangan Variabel (Rp)" },
  { field: "transport_allowance", label: "Tunjangan Transport (Rp)" },
  { field: "meal_allowance", label: "Tunjangan Makan (Rp)" },
  { field: "housing_allowance", label: "Tunjangan Rumah (Rp)" },
];

const DEDUCTION_FIELDS: { field: SalaryAmountField; label: string }[] = [
  { field: "loan_deduction", label: "Cicilan Pinjaman (Rp)" },
  { field: "other_deduction", label: "Potongan Lain (Rp)" },
];

interface SalaryAmountFieldsProps {
  values: Record<SalaryAmountField, string>;
  onChange: (field: SalaryAmountField, value: string) => void;
  /** Tandai gaji pokok wajib (form tambah). */
  baseSalaryRequired?: boolean;
}

/** Bagian "Penghasilan" dan "Potongan" yang sama di form tambah & edit salary. */
export function SalaryAmountFields({ values, onChange, baseSalaryRequired }: SalaryAmountFieldsProps) {
  const renderField = ({ field, label }: { field: SalaryAmountField; label: string }) => (
    <div key={field}>
      <Label htmlFor={field}>
        {label}
        {baseSalaryRequired && field === "base_salary" ? " *" : ""}
      </Label>
      <Input
        id={field}
        type="text"
        value={values[field]}
        onChange={(e) => onChange(field, formatRupiahInput(e.target.value))}
        className="mt-1"
        placeholder="0"
      />
    </div>
  );

  return (
    <>
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Penghasilan</h3>
        <div className="grid grid-cols-2 gap-4">{INCOME_FIELDS.map(renderField)}</div>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Potongan</h3>
        <div className="grid grid-cols-2 gap-4">{DEDUCTION_FIELDS.map(renderField)}</div>
      </div>
    </>
  );
}
