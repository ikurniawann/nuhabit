import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon } from "lucide-react";

export function PurchasingPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {description ? (
          <div className="mt-1 text-sm text-gray-500">{description}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">{actions}</div>
      ) : null}
    </div>
  );
}

export function PurchasingFormHeader({
  backHref,
  title,
  description,
  actions,
}: {
  backHref: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex items-start gap-3">
        <Link href={backHref}>
          <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
            <ArrowLeftIcon className="h-4 w-4" />
            Kembali
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          {description ? <p className="text-sm text-gray-500">{description}</p> : null}
        </div>
      </div>
      {actions ? (
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">{actions}</div>
      ) : null}
    </div>
  );
}

export function PurchasingFormFooter({
  onCancel,
  submitLabel = "Simpan",
  loading = false,
  disabled = false,
  formId,
}: {
  onCancel: () => void;
  submitLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  formId?: string;
}) {
  return (
    <div className="flex flex-col-reverse gap-3 border-t border-gray-200/70 pt-4 sm:flex-row sm:justify-end">
      <Button
        type="button"
        variant="outline"
        className="purchasing-secondary-button w-full sm:w-auto"
        onClick={onCancel}
        disabled={loading}
      >
        Batal
      </Button>
      <Button
        type="submit"
        form={formId}
        disabled={loading || disabled}
        className="purchasing-main-button w-full sm:w-auto"
      >
        {loading ? "Memproses..." : submitLabel}
      </Button>
    </div>
  );
}
