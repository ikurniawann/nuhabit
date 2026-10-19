import { useId } from "react";
import { FormFieldLabel, formInputClassName } from "@/components/layout/form-field";
import { Input } from "@/components/ui/input";

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: "text" | "email" | "date";
  className?: string;
}

export function TextField({ label, value, onChange, required, type, className }: TextFieldProps) {
  const id = useId();
  return (
    <div className={className}>
      <FormFieldLabel required={required} htmlFor={id}>{label}</FormFieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={formInputClassName}
      />
    </div>
  );
}
