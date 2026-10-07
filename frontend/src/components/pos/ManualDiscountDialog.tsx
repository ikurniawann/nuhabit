"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatIdrInput, parseIdrDigits } from "@/components/pos/idr-input";
import {
  computeDiscountAmount,
  isValidDiscountInput,
  type DiscountType,
} from "@/lib/pos/manual-discount";

type ManualDiscountDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  basis: number;
  formatCurrency: (value: number) => string;
  initialType?: DiscountType | null;
  initialValue?: number | null;
  onClose: () => void;
  onApply: (type: DiscountType, value: number) => void | Promise<void>;
  onClear?: () => void | Promise<void>;
};

function displayValue(
  type: DiscountType,
  value: number | null | undefined
): string {
  if (value == null || value <= 0) return "";
  if (type === "percent") return String(Math.min(100, value));
  return formatIdrInput(value);
}

/** Dirender hanya saat terbuka; key dari nilai awal → draf selalu mulai dari diskon yang berlaku. */
export function ManualDiscountDialog(props: ManualDiscountDialogProps) {
  if (!props.open) return null;
  return <ManualDiscountBody key={`${props.initialType ?? ""}:${props.initialValue ?? ""}`} {...props} />;
}

function ManualDiscountBody({
  title,
  description,
  basis,
  formatCurrency,
  initialType = null,
  initialValue = null,
  onClose,
  onApply,
  onClear,
}: ManualDiscountDialogProps) {
  const [type, setType] = useState<DiscountType>(initialType ?? "percent");
  const [valueStr, setValueStr] = useState(() => displayValue(initialType ?? "percent", initialValue));
  const [busy, setBusy] = useState(false);

  const parsedValue = useMemo(() => {
    if (type === "percent") {
      const n = Number(valueStr);
      return Number.isFinite(n) ? n : 0;
    }
    return parseIdrDigits(valueStr);
  }, [type, valueStr]);

  const preview = useMemo(
    () => computeDiscountAmount(basis, type, parsedValue),
    [basis, type, parsedValue]
  );

  function handleTypeChange(next: DiscountType) {
    if (next === type) return;
    setType(next);
    // Re-format current numeric value for the new mode, capped to rules.
    if (next === "percent") {
      const pct = Math.min(100, Math.max(0, parsedValue));
      setValueStr(pct > 0 ? String(pct) : "");
    } else {
      const capped = Math.min(Math.max(0, Math.floor(basis)), Math.max(0, parsedValue));
      setValueStr(capped > 0 ? formatIdrInput(capped) : "");
    }
  }

  function handleValueChange(raw: string) {
    if (type === "percent") {
      const digits = raw.replace(/[^\d.]/g, "");
      if (digits === "" || digits === ".") {
        setValueStr(digits === "." ? "" : digits);
        return;
      }
      const n = Number(digits);
      if (!Number.isFinite(n)) return;
      setValueStr(String(Math.min(100, n)));
      return;
    }

    const amount = parseIdrDigits(raw);
    const capped = Math.min(Math.max(0, Math.floor(basis)), amount);
    setValueStr(formatIdrInput(capped));
  }

  async function handleApply() {
    const check = isValidDiscountInput(type, parsedValue, basis);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }
    setBusy(true);
    try {
      await onApply(type, type === "percent" ? parsedValue : Math.min(parsedValue, Math.floor(basis)));
      toast.success("Diskon diterapkan");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menerapkan diskon");
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    if (!onClear) return;
    setBusy(true);
    try {
      await onClear();
      toast.success("Diskon dihapus");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus diskon");
    } finally {
      setBusy(false);
    }
  }

  const hasExisting = Boolean(initialType && initialValue && initialValue > 0);

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>{title}</DialogPanelTitle>
          {description ? (
            <DialogPanelDescription>{description}</DialogPanelDescription>
          ) : null}
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => handleTypeChange("percent")}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                type === "percent"
                  ? "border-primary/40 bg-primary/10 text-brand-text"
                  : "border-gray-200/80 bg-white text-gray-700 hover:border-primary/30"
              }`}
            >
              Persen (%)
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleTypeChange("fixed")}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                type === "fixed"
                  ? "border-primary/40 bg-primary/10 text-brand-text"
                  : "border-gray-200/80 bg-white text-gray-700 hover:border-primary/30"
              }`}
            >
              Nominal (Rp)
            </button>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {type === "percent" ? "Nilai persen (maks. 100%)" : "Nilai rupiah"}
            </label>
            <Input
              type="text"
              inputMode={type === "percent" ? "decimal" : "numeric"}
              value={valueStr}
              disabled={busy || basis <= 0}
              onChange={(e) => handleValueChange(e.target.value)}
              placeholder={type === "percent" ? "mis. 10" : "mis. 10.000"}
              className="border-gray-200/80"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Maks. potongan: {formatCurrency(basis)} · Preview: {formatCurrency(preview)}
            </p>
          </div>
        </DialogPanelBody>
        <DialogFooter>
          {hasExisting && onClear ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void handleClear()}
              className="border-red-200/80 text-red-700 hover:bg-red-50"
            >
              Hapus
            </Button>
          ) : (
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Batal
            </Button>
          )}
          <Button type="button" disabled={busy || basis <= 0} onClick={() => void handleApply()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Terapkan"}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
